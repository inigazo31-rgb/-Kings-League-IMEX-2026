import { store } from "../store.js";
import { esc, icon, fmtDateLong, teamCrest } from "../utils.js";
import { toast } from "../ui.js";

const ACCESS_CODE = "VARDRID";
let clockInterval = null;

function sessionFor(match) {
  if (!match.refereeSession) match.refereeSession = null;
  return match.refereeSession;
}

function persist(match, session, reason = "referee-update") {
  clearInterval(clockInterval);
  match.refereeSession = session;
  store.save(reason);
  // A referee action is important: flush the existing debounced remote save now.
  if (store.supabase && store.remoteReady) {
    clearTimeout(store.saveTimer);
    store.saveTimer = 0;
    store.syncPromise = store.syncPromise.then(() => store.persistRemote()).catch((error) => {
      store.remoteError = error.message || "No se pudo sincronizar el acta.";
      store.syncStatus = "error";
      store.notify();
    });
  }
}

function teamName(id) {
  return store.team(id)?.name || "Equipo";
}

function playersFor(teamId) {
  return store.teamPlayers(teamId).filter((player) => player.status !== "released");
}

function gateView(match) {
  return `<div class="container page referee-page">
    <a class="text-link" href="#/partidos/${esc(match.id)}">← Volver al partido</a>
    <section class="referee-gate panel">
      <div class="referee-mark">${icon("whistle", 30)}</div>
      <p class="eyebrow">IMEX LEAGUE · ACCESO DE OFICIALES</p>
      <h1>Modo árbitro</h1>
      <p>Introduce el código de acceso para abrir el centro de control del partido.</p>
      <form data-ref-gate class="referee-gate__form">
        <label for="ref-code">Código de acceso</label>
        <input id="ref-code" name="code" type="password" autocomplete="off" placeholder="Introduce el código" required>
        <button class="btn btn--primary" type="submit">Entrar al arbitraje ${icon("arrow-right", 16)}</button>
        <p class="referee-error" data-ref-error hidden>Código incorrecto. Inténtalo de nuevo.</p>
      </form>
    </section>
  </div>`;
}

function setupView(match, existing = null) {
  const home = store.team(match.homeTeamId);
  const away = store.team(match.awayTeamId);
  if (!home || !away) return `<div class="container page">${icon("alert", 22)} <h2>Partido incompleto</h2><p>El organizador debe asignar los dos equipos antes de arbitrar.</p></div>`;
  const selectedHome = existing?.starters?.[home.id] || playersFor(home.id).slice(0, 7).map((p) => p.id);
  const selectedAway = existing?.starters?.[away.id] || playersFor(away.id).slice(0, 7).map((p) => p.id);
  const roster = (team, selected) => `<section class="referee-roster panel">
    <div class="panel__head"><div><p class="eyebrow">Alineación inicial</p><h3>${esc(team.name)}</h3></div><span class="pill pill--outline" data-lineup-count="${esc(team.id)}">${selected.length}/7</span></div>
    <div class="referee-player-list">
      ${playersFor(team.id).map((player) => `<label class="referee-player">
        <input type="checkbox" name="starter-${esc(team.id)}" value="${esc(player.id)}" ${selected.includes(player.id) ? "checked" : ""}>
        <span class="referee-player__number">${esc(player.number ?? "—")}</span>
        <span><strong>${esc(player.name)}</strong><small>${esc(player.position || "Jugador")}</small></span>
      </label>`).join("")}
    </div>
    <p class="field__hint">Selecciona exactamente 7 titulares.</p>
  </section>`;
  return `<div class="container page referee-page">
    <a class="text-link" href="#/partidos/${esc(match.id)}">← Volver al partido</a>
    <header class="referee-heading">
      <p class="eyebrow">PREPARACIÓN DEL ENCUENTRO</p><h1>Configurar arbitraje</h1>
      <p>${esc(home.short)} vs ${esc(away.short)} · ${esc(fmtDateLong(match.date))} · ${esc(match.time || "Hora pendiente")}</p>
    </header>
    <form data-ref-setup>
      <section class="panel referee-config">
        <div class="panel__head"><div><p class="eyebrow">Datos del encuentro</p><h3>Configuración arbitral</h3></div></div>
        <div class="referee-form-grid">
          <label class="field field--full"><span>Árbitro responsable</span><input name="referee" required value="${esc(existing?.referee || "")}" placeholder="Nombre completo"></label>
          <label class="field"><span>Tiempo por mitad (minutos)</span><input name="halfMinutes" type="number" min="1" max="90" required value="${esc(existing?.settings?.halfMinutes || 20)}"></label>
          <label class="field"><span>Medio tiempo (minutos)</span><input name="halftimeMinutes" type="number" min="1" max="30" required value="${esc(existing?.settings?.halftimeMinutes || 5)}"></label>
          <label class="field"><span>Sustituciones permitidas</span><input name="substitutionsAllowed" type="number" min="0" max="20" required value="${esc(existing?.settings?.substitutionsAllowed ?? 5)}"></label>
        </div>
      </section>
      <div class="referee-lineups"><div class="referee-lineups__title"><p class="eyebrow">PLANTILLAS DEL PARTIDO</p><h2>7 inicial</h2></div>${roster(home, selectedHome)}${roster(away, selectedAway)}</div>
      <div class="referee-sticky-action"><button class="btn btn--primary btn--lg" type="submit">Guardar configuración y continuar ${icon("arrow-right", 17)}</button></div>
    </form>
  </div>`;
}

function elapsedMs(session) {
  return Math.max(0, Number(session.elapsedMs) || 0) + (session.runningSince ? Math.max(0, Date.now() - session.runningSince) : 0);
}

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function currentMinute(session) {
  const seconds = Math.floor(elapsedMs(session) / 1000);
  return { minute: Math.floor(seconds / 60), second: seconds % 60, period: session.period || 1 };
}

function minuteLabel(event) {
  return `${event.period === 2 ? "2T" : "1T"} · ${event.minute ?? 0}'${event.second ? ` ${String(event.second).padStart(2, "0")}s` : ""}`;
}

function eventTitle(event) {
  const team = store.team(event.teamId);
  const player = store.player(event.playerId);
  if (event.type === "goal") return `Gol · ${player?.name || "Jugador"} (${team?.short || ""})`;
  if (event.type === "goal_x2") return `Gol x2 · ${player?.name || "Jugador"} (${team?.short || ""})`;
  if (event.type === "president_penalty") return `Gol de penal del presidente · ${event.presidentName || team?.name || ""}`;
  if (event.type === "yellow") return `Tarjeta amarilla · ${player?.name || "Jugador"}`;
  if (event.type === "red") return `Tarjeta roja · ${player?.name || "Jugador"}`;
  if (event.type === "substitution") return `Cambio · ${store.player(event.playerOutId)?.name || "—"} por ${store.player(event.playerInId)?.name || "—"}`;
  return event.label || "Incidencia";
}

function timeline(session) {
  return `<div class="referee-timeline">
    ${[...(session.events || [])].sort((a, b) => a.at - b.at).map((event) => `<article class="referee-event">
      <span class="referee-event__dot referee-event__dot--${esc(event.type)}"></span>
      <div class="referee-event__body"><strong>${esc(eventTitle(event))}</strong><small>${esc(minuteLabel(event))}</small></div>
    </article>`).join("") || `<p class="admin-empty">Todavía no hay incidencias registradas.</p>`}
  </div>`;
}

function actaView(match, session, confirmed = false) {
  const home = store.team(match.homeTeamId);
  const away = store.team(match.awayTeamId);
  const goals = (session.events || []).filter((event) => ["goal", "goal_x2", "president_penalty"].includes(event.type)).length;
  const yellows = (session.events || []).filter((event) => event.type === "yellow").length;
  const reds = (session.events || []).filter((event) => event.type === "red").length;
  const subs = (session.events || []).filter((event) => event.type === "substitution").length;
  return `<div class="container page referee-page">
    <a class="text-link" href="#/partidos/${esc(match.id)}">← Volver al partido</a>
    <header class="referee-heading"><p class="eyebrow">DOCUMENTO ARBITRAL</p><h1>Acta arbitral</h1><p>${esc(home?.name)} vs ${esc(away?.name)} · ${esc(fmtDateLong(match.date))}</p></header>
    <section class="panel referee-report">
      <div class="referee-report__top"><div><p class="eyebrow">IMEX LEAGUE · ${esc(match.title || `Jornada ${match.matchday}`)}</p><h2>Informe del árbitro</h2></div><span class="pill ${confirmed ? "pill--success" : "pill--warning"}">${confirmed ? "Acta confirmada" : "Pendiente de confirmar"}</span></div>
      <div class="referee-report__meta"><div><small>Árbitro</small><strong>${esc(session.referee)}</strong></div><div><small>Duración por mitad</small><strong>${esc(session.settings.halfMinutes)} min</strong></div><div><small>Medio tiempo</small><strong>${esc(session.settings.halftimeMinutes)} min</strong></div><div><small>Sustituciones</small><strong>${subs} / ${esc(session.settings.substitutionsAllowed)}</strong></div></div>
      <div class="referee-report__stats"><div><b>${goals}</b><span>Goles registrados</span></div><div><b>${yellows}</b><span>Amarillas</span></div><div><b>${reds}</b><span>Rojas</span></div><div><b>${subs}</b><span>Cambios</span></div></div>
      <div class="referee-report__notice"><strong>Este documento no registra el resultado oficial.</strong><span>El organizador deberá introducir el marcador manualmente en el formulario habitual del partido. Las incidencias arbitrales no modifican el marcador ni publican resultados.</span></div>
      <h3>Desarrollo del encuentro</h3>${timeline(session)}
      ${confirmed ? `<p class="referee-confirmed">Confirmada el ${esc(new Date(session.confirmedAt).toLocaleString("es-MX"))}</p>` : `<div class="referee-sticky-action"><button class="btn btn--primary btn--lg" type="button" data-confirm-acta>Confirmar acta arbitral</button></div>`}
      <div class="referee-finish"><button class="btn btn--danger" type="button" data-reset-referee>Reiniciar arbitraje desde cero</button></div>
    </section>
  </div>`;
}

function controlView(match, session) {
  const home = store.team(match.homeTeamId);
  const away = store.team(match.awayTeamId);
  const running = Boolean(session.runningSince);
  const live = session.status === "live";
  const halftime = session.status === "halftime";
  const readySecond = session.status === "ready-second";
  const finished = session.status === "finished";
  const periodLimit = (Number(session.settings.halfMinutes) + Number(session.addedMinutes?.[session.period - 1] || 0)) * 60000;
  return `<div class="container page referee-page referee-live">
    <a class="text-link" href="#/partidos/${esc(match.id)}">← Salir al partido</a>
    <header class="referee-heading"><p class="eyebrow">CENTRO DE CONTROL · ÁRBITRO</p><h1>${esc(home?.short)} <span>vs</span> ${esc(away?.short)}</h1><p>Árbitro: ${esc(session.referee)} · ${esc(match.pitch || "Cancha IMEX")}</p></header>
    <section class="referee-clock panel">
      <div class="referee-clock__top"><span class="pill ${live ? "pill--success" : "pill--outline"}">${live ? "EN JUEGO" : halftime ? "MEDIO TIEMPO" : readySecond ? "LISTO PARA 2.º TIEMPO" : finished ? "PARTIDO FINALIZADO" : "PREPARADO"}</span><span class="eyebrow">${session.period === 2 ? "SEGUNDO TIEMPO" : "PRIMER TIEMPO"}</span></div>
      <div class="referee-clock__time mono" data-ref-clock>00:00</div>
      <p class="referee-clock__caption" data-ref-clock-caption>${running ? "Cronómetro en marcha" : "Cronómetro detenido"}</p>
      <div class="referee-clock__actions">
        ${!session.startedAt ? `<button class="btn btn--primary btn--lg" type="button" data-start>Iniciar partido</button>` : ""}
        ${live ? `<button class="btn ${running ? "btn--danger" : "btn--primary"} btn--lg" type="button" data-pause>${running ? "Pausar cronómetro" : "Reanudar cronómetro"}</button><button class="btn btn--ghost" type="button" data-add-time>Añadir tiempo</button><button class="btn btn--ghost" type="button" data-lost-time>Registrar tiempo perdido</button>` : ""}
        ${halftime ? `<div class="referee-break"><strong>Descanso</strong><span>${esc(session.settings.halftimeMinutes)} minutos</span></div><button class="btn btn--primary btn--lg" type="button" data-second-half>Iniciar segundo tiempo</button>` : ""}
        ${readySecond ? `<button class="btn btn--primary btn--lg" type="button" data-second-half>Iniciar segundo tiempo</button>` : ""}
        ${finished ? `<button class="btn btn--primary btn--lg" type="button" data-review-acta>Revisar acta arbitral</button>` : ""}
      </div>
      <p class="referee-clock__extra" data-ref-extra></p>
    </section>
    ${live ? `<section class="referee-actions panel"><p class="eyebrow">REGISTRAR INCIDENCIA</p><div class="referee-action-grid">
      <button class="referee-action referee-action--yellow" type="button" data-card="yellow"><span class="referee-card-icon"></span><strong>Amarilla</strong></button>
      <button class="referee-action referee-action--red" type="button" data-card="red"><span class="referee-card-icon"></span><strong>Roja</strong></button>
      <button class="referee-action" type="button" data-event="substitution">${icon("arrow-left-right", 23)}<strong>Cambio</strong></button>
      <button class="referee-action" type="button" data-event="goal">${icon("goal", 23)}<strong>Gol</strong></button>
      <button class="referee-action" type="button" data-event="goal_x2">${icon("zap", 23)}<strong>Gol x2</strong></button>
      <button class="referee-action" type="button" data-event="president_penalty">${icon("goal", 23)}<strong>Penal presidente</strong></button>
    </div></section>` : ""}
    <section class="panel"><div class="panel__head"><div><p class="eyebrow">REGISTRO EN VIVO</p><h3>Línea del tiempo</h3></div><span class="pill pill--outline">${session.events.length} incidencias</span></div>${timeline(session)}</section>
    ${!finished && session.startedAt ? `<div class="referee-finish"><button class="btn btn--danger" type="button" data-finish>Finalizar partido</button></div>` : ""}
    ${finished ? `<div class="referee-sticky-action"><button class="btn btn--primary btn--lg" type="button" data-review-acta>Revisar y confirmar acta</button></div>` : ""}
    <div class="referee-finish"><button class="btn btn--danger" type="button" data-reset-referee>Reiniciar arbitraje desde cero</button></div>
    <div data-event-modal-root></div>
  </div>`;
}

function eventPicker(root, match, session, type) {
  const homeId = match.homeTeamId;
  const awayId = match.awayTeamId;
  const teamOptions = [{ id: homeId, name: teamName(homeId) }, { id: awayId, name: teamName(awayId) }];
  const modalRoot = root.querySelector("[data-event-modal-root]");
  const optionsFor = (teamId, mode) => {
    const active = session.activePlayerIds[teamId] || [];
    const roster = playersFor(teamId);
    const list = mode === "out" ? roster.filter((p) => active.includes(p.id)) : mode === "in" ? roster.filter((p) => !active.includes(p.id) && !(session.sentOffPlayerIds || []).includes(p.id)) : roster.filter((p) => active.includes(p.id));
    return list.map((p) => `<option value="${esc(p.id)}">${esc(p.number ?? "—")} · ${esc(p.name)}</option>`).join("");
  };
  const isChange = type === "substitution";
  modalRoot.innerHTML = `<div class="referee-modal-backdrop" data-event-backdrop><form class="referee-event-modal panel" data-event-form>
    <button class="referee-modal-close" type="button" data-event-cancel aria-label="Cerrar">×</button>
    <p class="eyebrow">NUEVA INCIDENCIA</p><h2>${type === "goal" ? "Registrar gol" : isChange ? "Registrar cambio" : type === "yellow" ? "Tarjeta amarilla" : "Tarjeta roja"}</h2>
    <label class="field"><span>Equipo</span><select name="teamId" required><option value="">Seleccionar equipo</option>${teamOptions.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label>
    ${isChange ? `<label class="field"><span>Jugador que sale</span><select name="playerOutId" required disabled><option value="">Selecciona equipo primero</option></select></label><label class="field"><span>Jugador que entra</span><select name="playerInId" required disabled><option value="">Selecciona equipo primero</option></select></label>` : type === "president_penalty" ? `<label class="field"><span>Nombre del presidente</span><input name="presidentName" maxlength="80" placeholder="Nombre del presidente" required></label>` : `<label class="field"><span>Jugador</span><select name="playerId" required disabled><option value="">Selecciona equipo primero</option></select></label>`}
    <div class="referee-modal-actions"><button class="btn btn--ghost" type="button" data-event-cancel>Cancelar</button><button class="btn btn--primary" type="submit">Registrar</button></div>
  </form></div>`;
  const form = modalRoot.querySelector("form");
  const teamSelect = form.elements.teamId;
  teamSelect.addEventListener("change", () => {
    if (isChange) {
      const out = form.elements.playerOutId;
      const incoming = form.elements.playerInId;
      out.innerHTML = '<option value="">Seleccionar jugador en cancha</option>' + optionsFor(teamSelect.value, "out");
      incoming.innerHTML = '<option value="">Seleccionar suplente</option>' + optionsFor(teamSelect.value, "in");
      out.disabled = incoming.disabled = !teamSelect.value;
    } else {
      const player = form.elements.playerId;
      player.innerHTML = '<option value="">Seleccionar jugador</option>' + optionsFor(teamSelect.value, "active");
      player.disabled = !teamSelect.value;
    }
  });
  modalRoot.querySelectorAll("[data-event-cancel]").forEach((button) => button.addEventListener("click", () => { modalRoot.innerHTML = ""; }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const teamId = values.get("teamId");
    const stamp = currentMinute(session);
    if (isChange) {
      const playerOutId = values.get("playerOutId");
      const playerInId = values.get("playerInId");
      if (session.substitutionsUsed >= session.settings.substitutionsAllowed) {
        toast("Ya se alcanzó el límite de sustituciones.", "danger");
        return;
      }
      session.activePlayerIds[teamId] = (session.activePlayerIds[teamId] || []).filter((id) => id !== playerOutId).concat(playerInId);
      session.substitutionsUsed += 1;
      session.events.push({ id: crypto.randomUUID(), type, teamId, playerOutId, playerInId, ...stamp, at: Date.now() });
    } else if (isPresidentPenalty) {
      const presidentName = String(values.get("presidentName") || "").trim();
      if (!presidentName) return;
      session.events.push({ id: crypto.randomUUID(), type, teamId, presidentName, ...stamp, at: Date.now() });
    } else {
      const playerId = values.get("playerId");
      if (!playerId) return;
      session.events.push({ id: crypto.randomUUID(), type, teamId, playerId, ...stamp, at: Date.now() });
      if (type === "red") {
        session.activePlayerIds[teamId] = (session.activePlayerIds[teamId] || []).filter((id) => id !== playerId);
        session.sentOffPlayerIds = [...(session.sentOffPlayerIds || []), playerId];
      }
    }
    persist(match, session, `referee-${type}`);
    modalRoot.innerHTML = "";
  });
}

function askMinutes(root, match, session, type) {
  const label = type === "added" ? "Minutos de tiempo añadido" : "Minutos perdidos";
  const modalRoot = root.querySelector("[data-event-modal-root]");
  modalRoot.innerHTML = `<div class="referee-modal-backdrop"><form class="referee-event-modal panel" data-minutes-form>
    <p class="eyebrow">CONTROL DEL TIEMPO</p><h2>${label}</h2>
    <label class="field"><span>Minutos</span><input name="minutes" type="number" min="1" max="30" value="1" required></label>
    <div class="referee-modal-actions"><button class="btn btn--ghost" type="button" data-event-cancel>Cancelar</button><button class="btn btn--primary" type="submit">Guardar</button></div>
  </form></div>`;
  modalRoot.querySelector("[data-event-cancel]").addEventListener("click", () => { modalRoot.innerHTML = ""; });
  modalRoot.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const minutes = Math.min(30, Math.max(1, Number(new FormData(event.currentTarget).get("minutes")) || 1));
    const stamp = currentMinute(session);
    if (type === "added") {
      session.addedMinutes[session.period - 1] = (session.addedMinutes[session.period - 1] || 0) + minutes;
    } else {
      session.lostMinutes[session.period - 1] = (session.lostMinutes[session.period - 1] || 0) + minutes;
    }
    session.events.push({ id: crypto.randomUUID(), type: type === "added" ? "added_time" : "lost_time", label: `${label}: ${minutes} min`, ...stamp, at: Date.now() });
    persist(match, session, `referee-${type}-time`);
    modalRoot.innerHTML = "";
  });
}

function flashCard(root, match, session, type) {
  const overlay = document.createElement("div");
  overlay.className = `referee-flash referee-flash--${type}`;
  overlay.innerHTML = `<div><span class="referee-flash__card"></span><strong>TARJETA ${type === "yellow" ? "AMARILLA" : "ROJA"}</strong></div>`;
  root.appendChild(overlay);
  window.setTimeout(() => {
    overlay.remove();
    eventPicker(root, match, session, type);
  }, 5000);
}

function startClock(match, session) {
  session.startedAt = session.startedAt || Date.now();
  session.status = "live";
  session.period = 1;
  session.elapsedMs = 0;
  session.runningSince = Date.now();
  session.events.push({ id: crypto.randomUUID(), type: "kickoff", label: "Inicio del partido", minute: 0, second: 0, period: 1, at: Date.now() });
  persist(match, session, "referee-kickoff");
}

function pauseClock(match, session) {
  if (session.runningSince) {
    session.elapsedMs = elapsedMs(session);
    session.runningSince = null;
    session.events.push({ id: crypto.randomUUID(), type: "pause", label: "Cronómetro pausado", ...currentMinute(session), at: Date.now() });
  } else {
    session.runningSince = Date.now();
    session.events.push({ id: crypto.randomUUID(), type: "resume", label: "Cronómetro reanudado", ...currentMinute(session), at: Date.now() });
  }
  persist(match, session, "referee-clock");
}

function finishPeriod(match, session) {
  const periodLimit = (Number(session.settings.halfMinutes) + Number(session.addedMinutes?.[session.period - 1] || 0)) * 60000;
  session.elapsedMs = Math.min(elapsedMs(session), periodLimit);
  session.runningSince = null;
  if (session.period === 1) {
    session.status = "halftime";
    session.halftimeStartedAt = Date.now();
    session.events.push({ id: crypto.randomUUID(), type: "halftime", label: "Fin del primer tiempo", ...currentMinute(session), at: Date.now() });
  } else {
    session.status = "finished";
    session.finishedAt = Date.now();
    session.events.push({ id: crypto.randomUUID(), type: "fulltime", label: "Final del partido", ...currentMinute(session), at: Date.now() });
  }
  persist(match, session, "referee-period-finished");
}

function startSecondHalf(match, session) {
  session.period = 2;
  session.elapsedMs = 0;
  session.runningSince = Date.now();
  session.status = "live";
  session.events.push({ id: crypto.randomUUID(), type: "second_half", label: "Inicio del segundo tiempo", minute: 0, second: 0, period: 2, at: Date.now() });
  persist(match, session, "referee-second-half");
}

function bindClock(root, match, session) {
  clearInterval(clockInterval);
  const update = () => {
    const clock = root.querySelector("[data-ref-clock]");
    if (!clock) return;
    const caption = root.querySelector("[data-ref-clock-caption]");
    if (session.status === "halftime") {
      const breakElapsed = Math.max(0, Date.now() - (session.halftimeStartedAt || Date.now()));
      const remaining = Math.max(0, Number(session.settings.halftimeMinutes) * 60000 - breakElapsed);
      clock.textContent = formatClock(remaining);
      if (caption) caption.textContent = "Descanso · tiempo restante";
      if (remaining <= 0) {
        session.status = "ready-second";
        persist(match, session, "referee-halftime-ended");
      }
      return;
    }
    const elapsed = elapsedMs(session);
    clock.textContent = formatClock(elapsed);
    if (caption) caption.textContent = session.runningSince ? "Cronómetro en marcha" : "Cronómetro detenido";
    const extra = root.querySelector("[data-ref-extra]");
    if (extra) {
      const add = session.addedMinutes?.[session.period - 1] || 0;
      const lost = session.lostMinutes?.[session.period - 1] || 0;
      extra.textContent = `Tiempo añadido: +${add} min · Tiempo perdido registrado: ${lost} min`;
    }
    const target = (Number(session.settings.halfMinutes) + Number(session.addedMinutes?.[session.period - 1] || 0)) * 60000;
    if (session.status === "live" && session.runningSince && elapsed >= target) {
      finishPeriod(match, session);
    }
  };
  update();
  if (session.runningSince || session.status === "halftime") clockInterval = window.setInterval(update, 250);
}

export default {
  render({ params }) {
    const match = store.match(params.id);
    if (!match) return `<div class="container page"><h2>Partido no encontrado</h2><a href="#/partidos">Volver a partidos</a></div>`;
    if (sessionStorage.getItem(`imex.referee.${match.id}`) !== "ok") return gateView(match);
    const session = sessionFor(match);
    if (!session) return setupView(match);
    if (session.confirmedAt) return actaView(match, session, true);
    if (session.status === "finished") return actaView(match, session, false);
    return controlView(match, session);
  },
  bind(root, { params }) {
    const match = store.match(params.id);
    if (!match) return;
    if (sessionStorage.getItem(`imex.referee.${match.id}`) !== "ok") {
      root.querySelector("[data-ref-gate]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const code = new FormData(event.currentTarget).get("code");
        if (String(code || "").trim().toUpperCase() !== ACCESS_CODE) {
          root.querySelector("[data-ref-error]").hidden = false;
          return;
        }
        sessionStorage.setItem(`imex.referee.${match.id}`, "ok");
        location.hash = `#/arbitraje/${encodeURIComponent(match.id)}?acceso=1`;
      });
      return;
    }
    const session = sessionFor(match);
    if (!session) {
      const form = root.querySelector("[data-ref-setup]");
      form?.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener("change", () => {
        const count = form.querySelectorAll(`input[name="${input.name}"]:checked`).length;
        const badge = form.querySelector(`[data-lineup-count="${input.name.replace("starter-", "")}"]`);
        if (badge) badge.textContent = `${count}/7`;
      }));
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const homeIds = data.getAll(`starter-${match.homeTeamId}`);
        const awayIds = data.getAll(`starter-${match.awayTeamId}`);
        if (homeIds.length !== 7 || awayIds.length !== 7) {
          toast("Debes seleccionar exactamente 7 titulares por equipo.", "danger");
          return;
        }
        const halfMinutes = Number(data.get("halfMinutes"));
        const halftimeMinutes = Number(data.get("halftimeMinutes"));
        const substitutionsAllowed = Number(data.get("substitutionsAllowed"));
        if (!halfMinutes || !halftimeMinutes || !Number.isInteger(substitutionsAllowed) || substitutionsAllowed < 0) {
          toast("Revisa los tiempos y el límite de sustituciones.", "danger");
          return;
        }
        const starters = { [match.homeTeamId]: homeIds, [match.awayTeamId]: awayIds };
        const next = {
          referee: String(data.get("referee") || "").trim(),
          settings: { halfMinutes, halftimeMinutes, substitutionsAllowed },
          starters,
          activePlayerIds: structuredClone(starters),
          sentOffPlayerIds: [],
          substitutionsUsed: 0,
          events: [],
          period: 1,
          status: "ready",
          elapsedMs: 0,
          runningSince: null,
          addedMinutes: [0, 0],
          lostMinutes: [0, 0],
          startedAt: null,
          confirmedAt: null
        };
        if (!next.referee) {
          toast("Escribe el nombre del árbitro.", "danger");
          return;
        }
        persist(match, next, "referee-setup");
        location.hash = `#/arbitraje/${encodeURIComponent(match.id)}?preparado=1`;
      });
      return;
    }
    root.querySelector("[data-reset-referee]")?.addEventListener("click", () => {
      if (!window.confirm("¿Reiniciar el partido desde cero? Se borrarán cronómetro, alineaciones, goles, tarjetas, cambios e incidencias del acta arbitral. El resultado oficial del torneo no se modificará.")) return;
      clearInterval(clockInterval);
      match.refereeSession = null;
      store.save("referee-reset");
      location.hash = "#/arbitraje/" + encodeURIComponent(match.id) + "?reiniciado=" + Date.now();
    });
    if (session.confirmedAt) return;
    root.querySelector("[data-start]")?.addEventListener("click", () => startClock(match, session));
    root.querySelector("[data-pause]")?.addEventListener("click", () => pauseClock(match, session));
    root.querySelector("[data-add-time]")?.addEventListener("click", () => askMinutes(root, match, session, "added"));
    root.querySelector("[data-lost-time]")?.addEventListener("click", () => askMinutes(root, match, session, "lost"));
    root.querySelector("[data-second-half]")?.addEventListener("click", () => startSecondHalf(match, session));
    root.querySelector("[data-finish]")?.addEventListener("click", () => {
      if (session.status === "live") finishPeriod(match, session);
      else if (session.status !== "finished") {
        session.status = "finished";
        session.runningSince = null;
        session.finishedAt = Date.now();
        session.events.push({ id: crypto.randomUUID(), type: "fulltime", label: "Final del partido", ...currentMinute(session), at: Date.now() });
        persist(match, session, "referee-finish");
      }
    });
    root.querySelectorAll("[data-card]").forEach((button) => button.addEventListener("click", () => flashCard(root, match, session, button.dataset.card)));
    root.querySelectorAll("[data-event]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.event === "substitution" && session.substitutionsUsed >= session.settings.substitutionsAllowed) {
        toast("Ya se alcanzó el límite de sustituciones.", "warning");
        return;
      }
      eventPicker(root, match, session, button.dataset.event);
    }));
    root.querySelectorAll("[data-review-acta]").forEach((button) => button.addEventListener("click", () => {
      root.innerHTML = actaView(match, session, false);
      bind(root, { params });
    }));
    root.querySelector("[data-confirm-acta]")?.addEventListener("click", () => {
      if (session.status !== "finished" || !session.startedAt || !session.finishedAt || !session.starters?.[match.homeTeamId]?.length || !session.starters?.[match.awayTeamId]?.length) {
        toast("El acta no está completa. Finaliza el partido y revisa las alineaciones.", "danger");
        return;
      }
      session.confirmedAt = Date.now();
      persist(match, session, "referee-acta-confirmed");
      root.innerHTML = actaView(match, session, true);
    });
    if (session.status === "live" || session.status === "halftime") bindClock(root, match, session);
  }
};
