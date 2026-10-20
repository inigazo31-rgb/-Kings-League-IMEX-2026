import { store } from "../store.js";
import { esc, icon, money, number, playerPortrait, positionLabel } from "../utils.js";
import { openModal, toast } from "../ui.js";

const SLOTS = [
  ["POR", "Portero", 1],
  ["DEF", "Defensa", 1],
  ["MED", "Mediocampista", 1],
  ["DEL", "Delantero", 2]
];

const SLOT_ORDER = ["POR", "DEF", "MED", "DEL"];

function myManager() {
  return store.user ? store.myFantasy(store.user.id) : null;
}

function currentRoundKey() {
  return store.fantasyCurrentRound();
}

function roundLabel(key) {
  if (!key) return "—";
  if (key === "semifinals") return "Semifinales";
  if (key === "final") return "Final";
  return key.replace(/^J/, "Jornada ");
}

// Mismos tramos que store.js (fantasyBonus).
function fantasyBonusValue(total) {
  if (total <= 10) return 1;
  if (total <= 20) return 5;
  if (total <= 30) return 10;
  if (total <= 40) return 20;
  if (total <= 50) return 30;
  return 30 + 10 * Math.ceil((total - 50) / 10);
}

function rowsOf(manager) {
  return manager.lineup.map((id) => store.player(id)).filter(Boolean);
}

function pitchHtml(manager) {
  const byPos = {};
  for (const player of rowsOf(manager)) (byPos[player.position] ||= []).push(player);
  const roundKey = currentRoundKey();
  const captain = manager?.captains?.[roundKey];
  const cards = SLOT_ORDER.map((pos) => {
    const players = byPos[pos] || [];
    return `<div class="pitch__row">${players.map((player) => {
      const team = store.team(player.teamId);
      const isCaptain = captain === player.id;
      return `<button class="pitch__slot pitch__slot--filled" type="button" data-player="${esc(player.id)}" title="${esc(player.name)}">
        <b>${esc(player.name.split(" ").slice(-2).join(" "))}${isCaptain ? " · C" : ""}</b>
        <span>${esc(team?.short || "")} · ${esc(positionLabel(player.position))} · ${money(store.fantasyPrice(player))}</span>
      </button>`;
    }).join("")}</div>`;
  });
  return cards.join("");
}

function squadListHtml(manager, { market }) {
  const roundKey = currentRoundKey();
  const captain = manager?.captains?.[roundKey];
  const rows = rowsOf(manager);
  if (!rows.length) return `<div class="admin-empty">Aún no tienes plantilla. Elige 5 jugadores con ${money(store.fantasyStartBalance())} de saldo.</div>`;
  return `<div class="table-wrap"><table class="table table--stack">
    <thead><tr><th>Jugador</th><th>Pos.</th><th class="table__num">Precio</th><th class="table__num">Pts jornada</th><th></th></tr></thead>
    <tbody>${rows.map((player) => {
      const team = store.team(player.teamId);
      const isCaptain = captain === player.id;
      const pts = roundKey ? store.fantasyRoundPoints(player, roundKey) : 0;
      return `<tr>
        <td data-label="Jugador"><strong>${esc(player.name)}</strong><span class="small"> · ${esc(team?.short || "")}</span></td>
        <td data-label="Pos."><span class="mono small">${esc(player.position)}</span></td>
        <td class="table__num" data-label="Precio">${money(store.fantasyPrice(player))}</td>
        <td class="table__num" data-label="Pts">${isCaptain ? `${pts * 2} (x2)` : pts}</td>
        <td data-label="Acciones">
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${!roundKey || store.fantasyRoundComplete(roundKey) ? "" : `<button class="btn btn--ghost btn--xs" type="button" data-captain="${esc(player.id)}" ${isCaptain ? "disabled" : ""}>${isCaptain ? "Capitán" : "Hacer capitán"}</button>`}
            ${market ? `<button class="btn btn--danger btn--xs" type="button" data-release="${esc(player.id)}">Rescindir (${money(Math.floor(store.fantasyPrice(player) / 2))})</button>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function summaryHtml(manager) {
  const balance = manager ? Number(manager.balance) || 0 : 0;
  const start = store.fantasyStartBalance();
  const used = manager ? rowsOf(manager).reduce((sum, p) => sum + store.fantasyPrice(p), 0) : 0;
  const points = manager ? store.fantasyManagerPoints(manager) : 0;
  return `<div class="budget-bar">
      <div class="budget-bar__head"><span>Saldo disponible</span><strong style="color:${balance < 0 ? "var(--danger)" : "var(--success)"}">${money(balance)}</strong></div>
      <div class="budget-bar__head"><span>Invertido en cartas</span><strong>${money(used)} / ${money(start)}</strong></div>
    </div>
    <div class="lineup-summary">
      <div class="lineup-summary__points"><strong>${number(points)}</strong><span>puntos acumulados</span></div>
    </div>`;
}

function setupHtml() {
  const players = [...store.state.players].sort((a, b) => a.position.localeCompare(b.position) || store.fantasyPrice(a) - store.fantasyPrice(b));
  const start = store.fantasyStartBalance();
  return `<div class="field" style="margin-bottom:14px">
      <label for="fantasyManagerName">Nombre del equipo</label>
      <input id="fantasyManagerName" maxlength="40" value="${esc(store.user?.name ? `${store.user.name.split(" ")[0]} FC` : "Mi equipo")}">
    </div>
    <p class="small">Elige 1 portero, 1 defensa, 1 mediocampista y 2 delanteros. Saldo: ${money(start)}.</p>
    <div class="picker-list" data-setup-list>
      ${SLOT_ORDER.map((pos) => `<h4 class="eyebrow" style="margin:12px 0 6px">${esc(positionLabel(pos))}</h4>` + players.filter((p) => p.position === pos).map((player) => {
        const team = store.team(player.teamId);
        const left = store.fantasyCopiesLeft(player);
        return `<label class="picker-row" style="display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border);padding:8px 0">
          <input type="checkbox" data-setup-pick="${esc(player.id)}" data-pos="${pos}" data-price="${store.fantasyPrice(player)}" ${left < 1 ? "disabled" : ""}>
          ${playerPortrait(player, team, "sm")}
          <span class="picker-row__main"><strong>${esc(player.name)}</strong><span>${esc(team?.short || "")} · ${number(store.fantasyPoints(player))} pts · ${left} copias</span></span>
          <span class="picker-row__value">${money(store.fantasyPrice(player))}</span>
        </label>`;
      }).join("")).join("")}
    </div>
    <div class="row row--between" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      <strong data-setup-total>0 / ${money(start)}</strong>
      <button class="btn btn--primary" type="button" data-setup-save>${icon("check", 14)} Crear plantilla</button>
    </div>`;
}

function marketHtml(manager) {
  const open = store.fantasyMarketOpen();
  if (!open) return `<div class="admin-empty">El mercado Fantasy está cerrado. Lo abre el organizador.</div>`;
  const players = store.state.players
    .filter((p) => !manager.lineup.includes(p.id))
    .sort((a, b) => store.fantasyPoints(b) - store.fantasyPoints(a));
  return `<div class="table-wrap"><table class="table table--stack">
    <thead><tr><th>Jugador</th><th>Pos.</th><th class="table__num">Precio</th><th>Copias</th><th></th></tr></thead>
    <tbody>${players.map((player) => {
      const team = store.team(player.teamId);
      const left = store.fantasyCopiesLeft(player);
      const hasSlot = store.fantasySlotsFree(manager, player.position) > 0;
      const price = store.fantasyPrice(player);
      const owner = store.state.fantasy.managers.find((m) => m.lineup.includes(player.id));
      return `<tr>
        <td data-label="Jugador"><strong>${esc(player.name)}</strong><span class="small"> · ${esc(team?.short || "")}</span></td>
        <td data-label="Pos."><span class="mono small">${esc(player.position)}</span></td>
        <td class="table__num" data-label="Precio">${money(price)}</td>
        <td data-label="Copias">${left} libres${owner ? ` · dueño: ${esc(owner.name)}` : ""}</td>
        <td data-label="Acciones"><div class="row" style="gap:6px;flex-wrap:wrap">
          ${!owner && left > 0 && hasSlot ? `<button class="btn btn--ghost btn--xs" type="button" data-buy="${esc(player.id)}">Fichar (${money(price)})</button>` : ""}
          ${owner && owner.id !== manager.id ? `<button class="btn btn--ghost btn--xs" type="button" data-clausula="${esc(player.id)}">Clausulazo (${money(price)})</button>
            <button class="btn btn--ghost btn--xs" type="button" data-offer="${esc(player.id)}">Ofertar</button>` : ""}
        </div></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function offersHtml(manager) {
  const offers = (store.state.fantasy.offers || []).filter((o) => o.status === "pending");
  const mine = offers.filter((o) => manager && o.sellerId === manager.id);
  const sent = offers.filter((o) => manager && o.buyerId === manager.id);
  if (!manager) return "";
  if (!mine.length && !sent.length) return `<div class="admin-empty">Sin ofertas pendientes.</div>`;
  const row = (o, incoming) => {
    const target = store.player(o.targetId);
    const other = store.state.fantasy.managers.find((m) => m.id === (incoming ? o.buyerId : o.sellerId));
    return `<div class="fantasy-row">
      <div class="fantasy-row__team"><strong>${esc(target?.name || "—")}</strong><span>${incoming ? "Oferta de" : "Oferta a"} ${esc(other?.name || "—")}</span></div>
      <span class="fantasy-row__pts">${money(o.amount)}</span>
      ${incoming ? `<div class="row" style="gap:6px"><button class="btn btn--primary btn--xs" type="button" data-offer-accept="${esc(o.id)}">Aceptar</button><button class="btn btn--ghost btn--xs" type="button" data-offer-reject="${esc(o.id)}">Rechazar</button></div>` : `<span class="pill pill--outline">Pendiente</span>`}
    </div>`;
  };
  return `${mine.map((o) => row(o, true)).join("")}${sent.map((o) => row(o, false)).join("")}`;
}

function rankingHtml() {
  const managers = store.fantasyManagers();
  const user = store.user;
  if (!managers.length) return `<div class="admin-empty">Todavía no hay equipos Fantasy.</div>`;
  return managers.map((row, index) => `<div class="fantasy-row ${row.accountId === user?.id ? "is-me" : ""}">
    <span class="fantasy-row__rank">${index + 1}</span>
    <div class="fantasy-row__team"><strong>${esc(row.name)}</strong><span>${esc(row.owner || "Manager IMEX")}</span></div>
    <span class="fantasy-row__pts">${number(row.points)}</span>
    <span class="fantasy-row__spent">${money(row.balance)}</span>
  </div>`).join("");
}

function roundsHtml() {
  const keys = store.fantasyRoundKeys();
  if (!keys.length) return `<div class="admin-empty">Aún no hay jornadas con resultados.</div>`;
  const manager = myManager();
  return `<div class="table-wrap"><table class="table table--stack">
    <thead><tr><th>Jornada</th><th>Estado</th><th class="table__num">Mis puntos</th><th class="table__num">Bonus</th></tr></thead>
    <tbody>${keys.map((key) => {
      const done = store.fantasyRoundComplete(key);
      const pts = manager ? store.fantasyManagerRound(manager, key) : 0;
      return `<tr>
        <td data-label="Jornada">${esc(roundLabel(key))}</td>
        <td data-label="Estado">${done ? "Terminada" : "En curso"}</td>
        <td class="table__num" data-label="Mis puntos">${number(pts)}</td>
        <td class="table__num" data-label="Bonus">${done && manager ? money(fantasyBonusValue(store.fantasyManagerRound(manager, key))) : "—"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

export default {
  render() {
    const user = store.user;
    const manager = myManager();
    const managers = store.fantasyManagers();
    const myRow = managers.find((item) => item.accountId === user?.id);
    const myRank = myRow ? managers.indexOf(myRow) + 1 : null;
    const start = store.fantasyStartBalance();
    const market = store.fantasyMarketOpen();
    const roundKey = currentRoundKey();

    return `<div class="container page">
      <section class="fantasy-hero" style="margin-bottom:20px">
        <div>
          <p class="eyebrow">Fantasy IMEX · ${esc(store.state.league.season)}</p>
          <h1>Tu plantilla.<br />Tu estrategia.</h1>
          <p>Cada persona empieza con ${money(start)}. Ficha 5 jugadores (1 portero, 1 defensa, 1 mediocampista y 2 delanteros) y puntúa con sus resultados reales.</p>
          <div class="fantasy-hero__actions">
            ${user ? "" : `<a class="btn btn--accent" href="#/acceso?next=fantasy">${icon("lock", 16)} Iniciar sesión para jugar</a>`}
            <a class="btn btn--ghost" href="#/jugadores">${icon("users", 16)} Explorar jugadores</a>
          </div>
        </div>
        <div class="hero__side">
          <div class="market-hero__side" style="max-width:none;justify-self:stretch">
            <p class="eyebrow">Tu posición</p>
            <span class="countdown">${user ? (myRank ? `${myRank}º` : "Sin plantilla") : "—"}</span>
            <p class="small" style="color:rgba(243,241,235,.5);margin-top:8px">${user && myRow ? `${number(myRow.points)} puntos · ${money(myRow.balance)} de saldo` : "Crea tu plantilla para competir"}</p>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(243,241,235,.12)">
              <p class="eyebrow">Mercado</p>
              <strong style="font-family:var(--font-display);font-size:28px;letter-spacing:-.04em">${market ? "Abierto" : "Cerrado"}</strong>
            </div>
          </div>
        </div>
      </section>

      ${user && !manager ? `<section class="panel" style="margin-bottom:24px">
          <div class="panel__head"><div><h3>Crear tu plantilla</h3><p>Elige tus 5 jugadores dentro de ${money(start)}</p></div></div>
          ${setupHtml()}
        </section>` : ""}

      <div class="fantasy-grid">
        <section class="panel" id="fantasyBuilder">
          ${manager && store.fantasyMissingSlots(manager).length ? `<p class="notice" style="margin-bottom:14px"><div><strong>Tienes ${store.fantasyMissingSlots(manager).length} hueco(s) vacío(s)</strong><span>Ficha un jugador de esa posición antes de que cierre el mercado.</span></div></p>` : ""}
          <div class="panel__head">
            <div><h3>Mi plantilla</h3><p>${roundKey ? `Jornada activa: ${esc(roundLabel(roundKey))}` : "Sin jornadas con resultados"}</p></div>
            ${user ? `<span class="pill ${manager ? "pill--success" : "pill--warning"}">${manager ? "Activa" : "Sin plantilla"}</span>` : `<span class="pill pill--outline">Solo lectura</span>`}
          </div>
          ${manager ? `<div class="pitch" data-pitch>${pitchHtml(manager)}</div>
            <div data-fantasy-summary>${summaryHtml(manager)}</div>
            <div data-squad>${squadListHtml(manager, { market })}</div>` : `<div class="admin-empty">${user ? "Crea tu plantilla arriba." : "Inicia sesión para ver y crear tu plantilla."}</div>`}
        </section>

        <div class="stack">
          <section class="panel panel--flush">
            <div class="panel__head"><div><h3>Ranking</h3><p>Puntos acumulados por managers</p></div></div>
            <div style="padding:6px 20px 16px">${rankingHtml()}</div>
          </section>
          <section class="panel">
            <div class="panel__head"><div><h3>Cómo puntúa</h3><p>Puntos por jugador y partido</p></div></div>
            <div class="detail-list">
              <div class="detail-list__row"><span>Minutos 20 / 30 / 40</span><strong>1 / 2 / 3 pts</strong></div>
              <div class="detail-list__row"><span>Portería a cero (POR, DEF)</span><strong>+5 pts</strong></div>
              <div class="detail-list__row"><span>Gol POR / DEF / MED / DEL</span><strong>7 / 5 / 4 / 3 pts</strong></div>
              <div class="detail-list__row"><span>Valoración</span><strong>5 → 1 … 10 → 6 pts</strong></div>
              <div class="detail-list__row"><span>Amarilla / roja</span><strong>-3 / -5 pts</strong></div>
              <div class="detail-list__row"><span>Capitán</span><strong>Puntos x2</strong></div>
              <div class="detail-list__row"><span>Bonus por jornada</span><strong>Según el total (1 a 50+ M)</strong></div>
            </div>
          </section>
        </div>
      </div>

      ${manager ? `<div class="fantasy-grid" style="margin-top:24px">
        <section class="panel">
          <div class="panel__head"><div><h3>Mercado Fantasy</h3><p>Saldo ${money(manager.balance)} · ${market ? "abierto" : "cerrado"}</p></div></div>
          ${marketHtml(manager)}
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel__head"><div><h3>Ofertas</h3><p>Las que recibes y las que envías</p></div></div>
            <div style="padding:6px 20px 16px">${offersHtml(manager)}</div>
          </section>
          <section class="panel panel--flush">
            <div class="panel__head"><div><h3>Jornadas</h3><p>Tus puntos por jornada</p></div></div>
            ${roundsHtml()}
          </section>
        </div>
      </div>` : ""}
    </div>`;
  },

  bind(root) {
    const user = store.user;
    const manager = myManager();

    root.querySelector("[data-setup-list]")?.addEventListener("change", () => {
      const picks = [...root.querySelectorAll("[data-setup-pick]:checked")];
      const total = picks.reduce((sum, el) => sum + Number(el.dataset.price || 0), 0);
      const label = root.querySelector("[data-setup-total]");
      if (label) label.textContent = `${total} / ${store.fantasyStartBalance()}`;
    });

    root.querySelector("[data-setup-save]")?.addEventListener("click", () => {
      if (!user) {
        location.hash = "#/acceso?next=fantasy";
        return;
      }
      const picks = [...root.querySelectorAll("[data-setup-pick]:checked")];
      const lineup = picks.map((el) => el.dataset.setupPick);
      const name = root.querySelector("#fantasyManagerName")?.value?.trim() || "Mi equipo";
      const result = store.saveFantasyLineup({ accountId: user.id, managerName: name, lineup });
      toast(result.ok ? "Plantilla creada." : result.message, result.ok ? "success" : "danger");
      if (result.ok) rerenderFromStore();
    });

    root.querySelector("[data-squad]")?.addEventListener("click", (event) => {
      const cap = event.target.closest("[data-captain]");
      if (cap && manager) {
        const r = store.setFantasyCaptain({ accountId: user.id, roundKey: currentRoundKey(), playerId: cap.dataset.captain });
        toast(r.ok ? "Capitán elegido para esta jornada." : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
        return;
      }
      const rel = event.target.closest("[data-release]");
      if (rel && manager) {
        const r = store.fantasyRelease({ accountId: user.id, playerId: rel.dataset.release });
        toast(r.ok ? `Rescindido por ${money(r.refund)}.` : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
      }
    });

    root.addEventListener("click", (event) => {
      const buy = event.target.closest("[data-buy]");
      if (buy && manager) {
        const r = store.fantasyBuy({ accountId: user.id, playerId: buy.dataset.buy });
        toast(r.ok ? "Jugador fichado." : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
        return;
      }
      const claus = event.target.closest("[data-clausula]");
      if (claus && manager) {
        const r = store.fantasyClausulazo({ accountId: user.id, targetId: claus.dataset.clausula });
        toast(r.ok ? "Clausulazo ejecutado." : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
        return;
      }
      const offer = event.target.closest("[data-offer]");
      if (offer && manager) {
        openOfferForm(offer.dataset.offer, manager);
        return;
      }
      const acc = event.target.closest("[data-offer-accept]");
      if (acc) {
        const r = store.fantasyRespondOffer({ accountId: user.id, offerId: acc.dataset.offerAccept, accept: true });
        toast(r.ok ? "Oferta aceptada." : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
        return;
      }
      const rej = event.target.closest("[data-offer-reject]");
      if (rej) {
        const r = store.fantasyRespondOffer({ accountId: user.id, offerId: rej.dataset.offerReject, accept: false });
        toast(r.ok ? "Oferta rechazada." : r.message, r.ok ? "success" : "danger");
        if (r.ok) rerenderFromStore();
      }
    });
  }
};

// Las acciones guardan en el store; app.js repinta la vista al recibir el cambio (subscribe).
function rerenderFromStore() {}

function openOfferForm(targetId, manager) {
  const target = store.player(targetId);
  const owner = store.state.fantasy.managers.find((m) => m.lineup.includes(targetId));
  if (!target || !owner) return;
  const releasable = rowsOf(manager).filter((p) => p.position === target.position);
  if (!releasable.length) return toast(`Necesitas un ${positionLabel(target.position).toLowerCase()} que ofrecer a cambio.`, "danger");
  openModal({
    title: `Oferta por ${target.name}`,
    eyebrow: `Dueño: ${owner.name}`,
    size: "sm",
    body: `<form data-offer-form class="form-grid">
      <label class="field"><span>Importe (M)</span><input name="amount" type="number" min="0" step="1" value="${store.fantasyPrice(target)}" required></label>
      <label class="field"><span>Entregas a cambio</span><select name="release">${releasable.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
    </form>`,
    footer: `<button class="btn btn--ghost" type="button" data-modal-close>Cancelar</button><button class="btn btn--primary" type="button" data-offer-send>Enviar oferta</button>`,
    onMount(modal, closeModal) {
      modal.querySelector("[data-offer-send]")?.addEventListener("click", () => {
        const form = modal.querySelector("[data-offer-form]");
        const r = store.fantasyOffer({ accountId: store.user.id, targetId, releaseId: form.release.value, amount: form.amount.value });
        toast(r.ok ? "Oferta enviada." : r.message, r.ok ? "success" : "danger");
        if (r.ok) { closeModal(); rerenderFromStore(); }
      });
    }
  });
}
