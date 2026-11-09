/* Distrikt Marquet Interviews: Übersicht, Personenansicht, Suche mit Timecode */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const leiste = document.getElementById("leiste");
  const sucheFeld = document.getElementById("sucheFeld");
  const trefferBox = document.getElementById("treffer");
  const trefferListe = document.getElementById("trefferListe");
  const trefferKopf = document.getElementById("trefferKopf");
  const toastEl = document.getElementById("toast");
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let DATEN = null;
  const LABEL = { f: "Frage", o: "Off" };
  let held = null; // Bild, das beim Seitenwechsel mitwandert

  /* ---------- Hilfen ---------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const regexEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bild = (clip, w) => `bilder/${clip}_${w}.jpg`;

  function tcZuFrames(tc, fps) {
    const [h, m, s, f] = tc.split(/[:;]/).map(Number);
    return ((h * 60 + m) * 60 + s) * fps + f;
  }
  function framesZuTc(n, fps) {
    const tag = 24 * 3600 * fps;
    n = ((n % tag) + tag) % tag;
    const f = n % fps, s = Math.floor(n / fps) % 60, m = Math.floor(n / fps / 60) % 60, h = Math.floor(n / fps / 3600);
    return [h, m, s, f].map((x) => String(x).padStart(2, "0")).join(":");
  }
  const tcBei = (clip, sek) => framesZuTc(tcZuFrames(clip.tc, clip.fps) + Math.round(sek * clip.fps), clip.fps);
  function dauerText(sek) {
    const m = Math.round(sek / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
  }
  const minSek = (sek) => `${Math.floor(sek / 60)}:${String(Math.floor(sek % 60)).padStart(2, "0")}`;

  let toastZeit;
  function toast(html) {
    toastEl.innerHTML = html;
    toastEl.classList.add("zeigen");
    clearTimeout(toastZeit);
    toastZeit = setTimeout(() => toastEl.classList.remove("zeigen"), 1900);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
  }
  async function kopieren(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy"); t.remove(); return ok;
    }
  }

  function zaehlen(el, ziel, dauer = 1100) {
    if (ruhig) { el.textContent = ziel.toLocaleString("de-DE"); return; }
    const start = performance.now();
    const schritt = () => {
      const t = Math.min(1, (performance.now() - start) / dauer);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(ziel * e).toLocaleString("de-DE");
      if (t < 1) setTimeout(schritt, 16);
    };
    schritt();
  }

  /* ---------- Text für Export ---------- */
  function textVon(p) {
    const zeilen = [];
    zeilen.push(`${p.name}${p.rolle ? " · " + p.rolle : ""}`);
    zeilen.push(`Distrikt Marquet, Interview vom ${DATEN.dreh}`);
    p.clips.forEach((c, i) => zeilen.push(`Clip ${p.clips.length > 1 ? i + 1 + " " : ""}Totale ${c.totale} ab ${c.tc}, Nah ${c.nah} ab ${c.nahTc}, ${minSek(c.dauer)} min`));
    zeilen.push("Maschinell transkribiert (Whisper large-v3-turbo), vor Verwendung gegenprüfen.");
    zeilen.push("");
    p.absaetze.forEach((a) => {
      const c = p.clips[a.c];
      const satz = a.s.map((s) => s[1]).join(" ");
      zeilen.push(`[${tcBei(c, a.t)}]${p.clips.length > 1 ? " " + c.totale.slice(0, 8) : ""} ${a.v ? "(Vorgespräch) " : ""}${LABEL[a.k] ? LABEL[a.k].toUpperCase() + ": " : ""}${satz}`);
      zeilen.push("");
    });
    return zeilen.join("\n");
  }
  function textUrl(text) {
    return URL.createObjectURL(new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" }));
  }

  /* ---------- Seitenwechsel ---------- */
  let ersterAufbau = true;
  function wechseln(render) {
    if (ersterAufbau || !document.startViewTransition || ruhig || document.hidden) { ersterAufbau = false; render(); return; }
    const vt = document.startViewTransition(render);
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p && p.catch(() => {}));
  }

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const teile = h.split("/");
    if (teile[0] === "p" && teile[1]) {
      const p = DATEN.personen.find((x) => x.id === teile[1]);
      if (p) return { art: "person", p, absatz: teile[2] != null ? Number(teile[2]) : null, q: new URLSearchParams(location.search).get("q") };
    }
    return { art: "uebersicht" };
  }

  let letzteRoute = null;
  function zeigen() {
    const r = route();
    const vorher = letzteRoute;
    letzteRoute = r;
    // Nur Sprung im selben Interview: kein neuer Aufbau
    if (vorher && vorher.art === "person" && r.art === "person" && vorher.p === r.p && r.absatz != null) {
      springeZu(r.absatz, true);
      return;
    }
    wechseln(() => {
      if (r.art === "person") renderPerson(r.p, r.absatz);
      else renderUebersicht(vorher && vorher.art === "person" ? vorher.p.id : null);
      document.title = r.art === "person" ? `${r.p.name} · Distrikt Marquet Interviews` : "Distrikt Marquet Interviews";
    });
  }

  /* ---------- Übersicht ---------- */
  function renderUebersicht(vonId) {
    app.replaceChildren($("#tplUebersicht").content.cloneNode(true));
    const raster = $("#raster");
    const zahlwort = ["Null", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];
    const n = DATEN.personen.length;
    $("[data-anzahl-personen]").textContent = zahlwort[n] || n;

    DATEN.personen.forEach((p, i) => {
      const k = $("#tplKarte").content.firstElementChild.cloneNode(true);
      k.style.setProperty("--i", i);
      const a = $(".karte-link", k);
      a.href = `#/p/${p.id}`;
      const img = $("img", k);
      img.src = bild(p.bild, 640);
      img.srcset = `${bild(p.bild, 640)} 640w, ${bild(p.bild, 1280)} 1280w`;
      img.sizes = "(max-width: 734px) 100vw, (max-width: 1068px) 50vw, 33vw";
      img.alt = `${p.name} in der Totale`;
      if (p.id === vonId) img.style.viewTransitionName = "held";
      $(".karte-dauer", k).textContent = minSek(p.dauer);
      $(".karte-name", k).textContent = p.name;
      $(".karte-rolle", k).textContent = p.rolle || "";
      $(".karte-zitat", k).textContent = p.zitat ? `„${p.zitat}“` : "";
      a.addEventListener("click", () => { held = img; img.style.viewTransitionName = "held"; });
      raster.appendChild(k);
    });

    // gestaffelt einblenden
    const io = new IntersectionObserver((eintraege) => {
      eintraege.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("da"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    raster.querySelectorAll(".karte").forEach((k) => io.observe(k));
    setTimeout(() => raster.querySelectorAll(".karte").forEach((k) => k.classList.add("da")), 2500);

    const minuten = Math.round(DATEN.personen.reduce((s, p) => s + p.dauer, 0) / 60);
    const woerter = DATEN.personen.reduce((s, p) => s + p.woerter, 0);
    zaehlen($("[data-stat-minuten]"), minuten);
    zaehlen($("[data-stat-woerter]"), woerter, 1400);

    const alle = DATEN.personen.map(textVon).join("\n\n" + "=".repeat(60) + "\n\n");
    const link = $("#alleLaden");
    link.href = textUrl(alle);
    link.download = "Distrikt_Marquet_Interviews_2026-11-03.txt";

    if (vonId) {
      const ziel = raster.querySelector(`a[href="#/p/${vonId}"]`);
      if (ziel) { ziel.closest(".karte").classList.add("da"); ziel.scrollIntoView({ block: "center" }); }
      requestAnimationFrame(() => setTimeout(() => raster.querySelectorAll("img").forEach((i) => (i.style.viewTransitionName = "")), 700));
    } else {
      window.scrollTo(0, 0);
    }
  }

  /* ---------- Person ---------- */
  let aktuell = null;

  function absatzHtml(p, a, idx, re) {
    const c = p.clips[a.c];
    const tc = tcBei(c, a.t);
    const saetze = a.s.map((s) => {
      let t = esc(s[1]);
      if (re) t = t.replace(re, (m) => `<mark>${m}</mark>`);
      return `<span class="satz" data-t="${s[0]}">${t}</span>`;
    }).join(" ");
    const clipHinweis = p.clips.length > 1 ? ` title="${c.totale}"` : "";
    return `<div class="absatz${a.k !== "a" ? " frage" : ""}${a.k === "o" ? " off" : ""}" id="a${idx}" data-i="${idx}">
      <div class="links"><button class="tc" type="button" data-tc="${tc}"${clipHinweis} aria-label="Timecode ${tc} kopieren">${tc}</button><button class="kopie" type="button" aria-label="Absatz mit Timecode kopieren" title="Absatz mit Timecode kopieren"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="9" height="10" rx="2"/><path d="M13.5 4.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 4v8A1.5 1.5 0 0 0 6 13.5h.5"/></svg></button></div>
      <p>${LABEL[a.k] ? `<span class="wer">${LABEL[a.k]}</span>` : ""}${saetze}</p></div>`;
  }

  function renderPerson(p, absatz) {
    aktuell = p;
    app.replaceChildren($("#tplPerson").content.cloneNode(true));
    const art = $(".person");
    const img = $(".person-bild img", art);
    img.src = bild(p.bild, 1280);
    img.srcset = `${bild(p.bild, 1280)} 1280w, ${bild(p.bild, 2560)} 2560w`;
    img.sizes = "(max-width: 1068px) 100vw, 42vw";
    img.alt = `${p.name} in der Totale, DIN.CLD.002`;
    img.style.viewTransitionName = "held";
    setTimeout(() => (img.style.viewTransitionName = ""), 700);
    $(".person-name", art).textContent = p.name;
    $(".person-rolle", art).textContent = p.rolle || "";

    const meta = $(".person-meta", art);
    const zeile = (dt, dd) => { const a = document.createElement("dt"); a.textContent = dt; const b = document.createElement("dd"); b.textContent = dd; meta.append(a, b); };
    p.clips.forEach((c, i) => {
      const nr = p.clips.length > 1 ? ` ${i + 1}` : "";
      zeile(`Totale${nr}`, `${c.totale} · FX3 · ab ${c.tc}`);
      zeile(`Nah${nr}`, `${c.nah} · A7S III · ab ${c.nahTc}`);
    });
    zeile("Länge", `${minSek(p.dauer)} min`);
    zeile("Wörter", p.woerter.toLocaleString("de-DE"));

    // Aktionen
    const text = textVon(p);
    $('[data-aktion="laden"]', art).href = textUrl(text);
    $('[data-aktion="laden"]', art).download = `${p.name.replace(/[^\wäöüÄÖÜß-]+/g, "_")}_Interview_2026-11-03.txt`;
    const kopierKnopf = $('[data-aktion="kopieren"]', art);
    kopierKnopf.addEventListener("click", async () => {
      if (await kopieren(text)) {
        kopierKnopf.textContent = "Kopiert";
        kopierKnopf.classList.add("ok");
        toast(`Transkript von <b>${esc(p.name)}</b> kopiert`);
        setTimeout(() => { kopierKnopf.textContent = "Text kopieren"; kopierKnopf.classList.remove("ok"); }, 1800);
      }
    });
    $('[data-aktion="drucken"]', art).addEventListener("click", () => window.print());

    // Transkript
    const box = $("[data-transkript]", art);
    const feld = $('[data-feld="lokal"]', art);
    const zaehler = $("[data-zaehler]", art);
    const fragen = $('[data-feld="fragen"]', art);
    let treffer = [], pos = -1, vorOffen = false;
    const vorZeigen = (an) => {
      vorOffen = an;
      const v = box.querySelector(".vorgespraech"), k = box.querySelector(".vor-knopf");
      if (v) { v.hidden = !an; k.setAttribute("aria-expanded", an); }
    };
    art.vorZeigen = vorZeigen;

    function zeichnen(q) {
      const re = q && q.trim().length > 1 ? new RegExp(regexEsc(q.trim()), "gi") : null;
      const vor = p.absaetze.filter((a) => a.v).length;
      const html = p.absaetze.map((a, i) => absatzHtml(p, a, i, re));
      if (vor) {
        const bis = p.absaetze[vor].t;
        box.innerHTML = `<button class="vor-knopf" type="button" aria-expanded="${vorOffen}"><span class="vor-pfeil" aria-hidden="true"></span>Vorgespräch <span>${minSek(bis)} min, Aufbau und Einstieg</span></button>` +
          `<div class="vorgespraech"${vorOffen ? "" : " hidden"}>${html.slice(0, vor).join("")}</div>` + html.slice(vor).join("");
      } else {
        box.innerHTML = html.join("") || '<p class="leer-hinweis">Kein Text erkannt.</p>';
      }
      treffer = [...box.querySelectorAll("mark")];
      pos = -1;
      zaehler.textContent = re ? (treffer.length ? `${treffer.length} Treffer` : "kein Treffer") : "";
    }
    function naechster(richtung = 1) {
      if (!treffer.length) return;
      treffer[pos]?.classList.remove("aktiv");
      pos = (pos + richtung + treffer.length) % treffer.length;
      const m = treffer[pos];
      m.classList.add("aktiv");
      if (m.closest(".vorgespraech")?.hidden) vorZeigen(true);
      const absatzEl = m.closest(".absatz");
      if (absatzEl.classList.contains("frage") && !fragen.checked) { fragen.checked = true; box.classList.remove("ohne-fragen"); }
      m.scrollIntoView({ block: "center", behavior: ruhig ? "auto" : "smooth" });
      zaehler.textContent = `${pos + 1} von ${treffer.length}`;
    }
    let tipp;
    feld.addEventListener("input", () => { clearTimeout(tipp); tipp = setTimeout(() => { zeichnen(feld.value); if (treffer.length) naechster(1); }, 140); });
    feld.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); naechster(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { feld.value = ""; zeichnen(""); feld.blur(); }
    });
    fragen.addEventListener("change", () => box.classList.toggle("ohne-fragen", !fragen.checked));

    box.addEventListener("click", async (e) => {
      if (e.target.closest(".vor-knopf")) { vorZeigen(!vorOffen); return; }
      const kb = e.target.closest(".kopie");
      if (kb) {
        const el = kb.closest(".absatz"), a = p.absaetze[el.dataset.i], c = p.clips[a.c];
        const t = `„${a.s.map((x) => x[1]).join(" ")}“\n${p.name}, ${c.totale} ${tcBei(c, a.t)}`;
        if (await kopieren(t)) { toast(`Absatz bei <b>${tcBei(c, a.t)}</b> kopiert`); kb.classList.add("ok"); setTimeout(() => kb.classList.remove("ok"), 1500); }
        return;
      }
      const b = e.target.closest(".tc");
      if (!b) return;
      if (await kopieren(b.dataset.tc)) toast(`Timecode <b>${b.dataset.tc}</b> kopiert`);
      const i = b.closest(".absatz").dataset.i;
      history.replaceState(null, "", `#/p/${p.id}/${i}`);
      letzteRoute = route();
    });

    // Blättern
    const liste = DATEN.personen, idx = liste.indexOf(p);
    const vor = liste[(idx - 1 + liste.length) % liste.length], nach = liste[(idx + 1) % liste.length];
    $(".blaettern", art).innerHTML =
      `<a href="#/p/${vor.id}"><small>Vorheriges Interview</small><img src="${bild(vor.bild, 640)}" alt="" loading="lazy"><strong>${esc(vor.name)}</strong></a>` +
      `<a class="naechste" href="#/p/${nach.id}"><small>Nächstes Interview</small><img src="${bild(nach.bild, 640)}" alt="" loading="lazy"><strong>${esc(nach.name)}</strong></a>`;

    const q = new URLSearchParams(location.search).get("q") || "";
    if (q) feld.value = q;
    zeichnen(q);
    art.classList.add("ein");

    if (absatz != null) requestAnimationFrame(() => springeZu(absatz, false));
    else window.scrollTo(0, 0);
  }

  function springeZu(i, weich) {
    const el = document.getElementById(`a${i}`);
    if (!el) return;
    if (el.closest(".vorgespraech")?.hidden) document.querySelector(".person")?.vorZeigen?.(true);
    if (el.classList.contains("frage")) {
      const s = $('[data-feld="fragen"]');
      if (s && !s.checked) { s.checked = true; $("[data-transkript]").classList.remove("ohne-fragen"); }
    }
    el.scrollIntoView({ block: "center", behavior: weich && !ruhig ? "smooth" : "auto" });
    el.classList.remove("ziel"); void el.offsetWidth; el.classList.add("ziel");
  }

  /* ---------- Globale Suche ---------- */
  let suchZeit;
  function globalSuchen(q) {
    q = q.trim();
    if (q.length < 2) { trefferBox.hidden = true; return; }
    const re = new RegExp(regexEsc(q), "gi");
    const items = [];
    let gesamt = 0;
    DATEN.personen.forEach((p) => {
      p.absaetze.forEach((a, i) => {
        const text = a.s.map((s) => s[1]).join(" ");
        const m = [...text.matchAll(re)];
        if (!m.length) return;
        gesamt += m.length;
        const at = m[0].index;
        const von = Math.max(0, at - 70), bis = Math.min(text.length, at + q.length + 110);
        let snip = (von > 0 ? "… " : "") + text.slice(von, bis) + (bis < text.length ? " …" : "");
        snip = esc(snip).replace(new RegExp(regexEsc(esc(q)), "gi"), (x) => `<mark>${x}</mark>`);
        items.push({ p, i, a, snip });
      });
    });
    trefferKopf.textContent = items.length ? `${gesamt} Treffer in ${new Set(items.map((x) => x.p)).size} Interviews` : "";
    trefferListe.innerHTML = items.length
      ? items.slice(0, 200).map((x, n) => `<li style="--i:${Math.min(n, 20)}"><a href="#/p/${x.p.id}/${x.i}" data-q="${esc(q)}">
          <img src="${bild(x.p.bild, 640)}" alt="" loading="lazy">
          <div><div class="wer">${esc(x.p.name)}<span>${tcBei(x.p.clips[x.a.c], x.a.t)}</span></div>
          <p class="was">${LABEL[x.a.k] ? `<em>${LABEL[x.a.k]}:</em> ` : ""}${x.snip}</p></div></a></li>`).join("")
      : `<li class="leer">Nichts gefunden für „${esc(q)}“.</li>`;
    trefferBox.hidden = false;
    trefferBox.scrollTop = 0;
  }
  sucheFeld.addEventListener("input", () => { clearTimeout(suchZeit); suchZeit = setTimeout(() => globalSuchen(sucheFeld.value), 120); });
  sucheFeld.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { sucheFeld.value = ""; trefferBox.hidden = true; sucheFeld.blur(); }
    if (e.key === "Enter") { const a = trefferListe.querySelector("a"); if (a) a.click(); }
    if (e.key === "ArrowDown") { e.preventDefault(); trefferListe.querySelector("a")?.focus(); }
  });
  trefferListe.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const q = a.dataset.q;
    trefferBox.hidden = true;
    const ziel = a.getAttribute("href");
    history.pushState(null, "", `?q=${encodeURIComponent(q)}${ziel}`);
    letzteRoute = null;
    zeigen();
  });
  trefferBox.addEventListener("click", (e) => { if (e.target === trefferBox) trefferBox.hidden = true; });

  /* ---------- Tastatur ---------- */
  document.addEventListener("keydown", (e) => {
    const tippt = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === "/" && !tippt) { e.preventDefault(); sucheFeld.focus(); sucheFeld.select(); return; }
    if (tippt || e.metaKey || e.ctrlKey || e.altKey) return;
    const r = route();
    if (r.art !== "person") return;
    const liste = DATEN.personen, i = liste.indexOf(r.p);
    if (e.key === "ArrowRight") location.hash = `#/p/${liste[(i + 1) % liste.length].id}`;
    if (e.key === "ArrowLeft") location.hash = `#/p/${liste[(i - 1 + liste.length) % liste.length].id}`;
    if (e.key === "Escape") location.hash = "#/";
  });

  addEventListener("scroll", () => leiste.classList.toggle("gerollt", scrollY > 8), { passive: true });
  addEventListener("hashchange", () => {
    if (location.search && !location.hash.startsWith("#/p/")) history.replaceState(null, "", location.pathname + location.hash);
    trefferBox.hidden = true;
    zeigen();
  });

  fetch("daten/interviews.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => { DATEN = d; zeigen(); })
    .catch(() => { app.innerHTML = '<p class="leer-hinweis" style="padding:40px var(--rand)">Daten konnten nicht geladen werden.</p>'; });
})();
