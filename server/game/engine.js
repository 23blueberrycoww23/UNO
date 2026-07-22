// Server-authoritative UNO game engine.
//
// Every mutation goes through a handle* method that validates:
//   - the player exists and is part of the game
//   - it is actually their turn (or a legal jump-in)
//   - they own the card they are playing
//   - the card is legal on the current pile under the active rules
// Clients can therefore never play cards they don't own, skip turns,
// modify hand sizes or otherwise manipulate state.

import { buildDeck, shuffle, COLORS, cardPoints } from './cards.js';
import { decideBotTurn, botCatchChance } from './bots.js';

const ACTION_OK = { ok: true };
const err = (message) => ({ ok: false, error: message });

export class UnoGame {
  /**
   * @param {object} opts
   * @param {Array}  opts.players   [{ id, name, avatar, isBot, difficulty }]
   * @param {object} opts.rules     sanitized rules object
   * @param {Function} opts.onUpdate  broadcast new state
   * @param {Function} opts.onEvent   broadcast an animation/feed event
   * @param {Function} opts.onFinish  game over callback with results
   */
  constructor({ players, rules, onUpdate, onEvent, onFinish }) {
    this.rules = rules;
    this.onUpdate = onUpdate;
    this.onEvent = onEvent;
    this.onFinish = onFinish;

    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || null,
      isBot: !!p.isBot,
      difficulty: p.difficulty || 'medium',
      connected: true,
      hand: [],
      saidUno: false,
      unoVulnerableUntil: 0,
      stats: { cardsPlayed: 0, drawCardsTaken: 0, unoCalls: 0 }
    }));

    this.drawPile = buildDeck(rules);
    this.discard = [];
    this.direction = 1;
    this.turnIndex = 0;
    this.currentColor = null;
    this.pendingDraw = 0;          // accumulated draw penalty
    this.pendingType = null;       // 'draw2' | 'wild4'
    this.pendingDrawnCardId = null; // card drawn this turn that may be played
    this.challenge = null;         // { victimId, offenderId, wasLegal }
    this.finished = false;
    this.winnerId = null;
    this.ranking = null;
    this.turnDeadline = 0;
    this.startedAt = Date.now();
    this._timers = { turn: null, bot: null, uno: [] };
    this._destroyed = false;
  }

  // ---------------------------------------------------------------- helpers

  top() { return this.discard[this.discard.length - 1]; }

  getPlayer(id) { return this.players.find((p) => p.id === id); }

  currentPlayer() { return this.players[this.turnIndex]; }

  nextIndex(steps = 1, from = this.turnIndex) {
    const n = this.players.length;
    return ((from + this.direction * steps) % n + n) % n;
  }

  /** Take the top card from the draw pile, reshuffling the discard if needed. */
  takeCard() {
    if (this.drawPile.length === 0) {
      if (this.discard.length <= 1) return null; // every card is in hands
      const topCard = this.discard.pop();
      this.drawPile = shuffle(this.discard);
      this.discard = [topCard];
      this.onEvent({ type: 'reshuffle' });
    }
    return this.drawPile.pop() || null;
  }

  giveCards(player, count) {
    const given = [];
    for (let i = 0; i < count; i++) {
      const card = this.takeCard();
      if (!card) break;
      player.hand.push(card);
      given.push(card);
    }
    if (given.length > 0) {
      player.saidUno = false;
      player.unoVulnerableUntil = 0;
      player.stats.drawCardsTaken += given.length;
    }
    return given;
  }

  // ----------------------------------------------------------------- start

  start() {
    for (let i = 0; i < this.rules.startingCards; i++) {
      for (const p of this.players) {
        const card = this.takeCard();
        if (card) p.hand.push(card);
      }
    }
    // Flip the first card: keep re-burying action/wild cards until a number
    // shows so the opening is always unambiguous.
    let first = this.takeCard();
    while (first && (first.color === 'wild' || isNaN(parseInt(first.value, 10)))) {
      this.drawPile.splice(Math.floor(Math.random() * (this.drawPile.length + 1)), 0, first);
      first = this.takeCard();
    }
    this.discard.push(first);
    this.currentColor = first.color;
    this.turnIndex = Math.floor(Math.random() * this.players.length);
    this.onEvent({ type: 'deal' });
    this.beginTurn();
  }

  // ------------------------------------------------------------ turn cycle

  beginTurn() {
    if (this.finished || this._destroyed) return;
    this.pendingDrawnCardId = null;
    clearTimeout(this._timers.turn);
    clearTimeout(this._timers.bot);

    if (this.rules.turnTime > 0) {
      this.turnDeadline = Date.now() + this.rules.turnTime * 1000;
      this._timers.turn = setTimeout(() => this.handleTimeout(), this.rules.turnTime * 1000 + 250);
    } else {
      this.turnDeadline = 0;
    }

    const p = this.currentPlayer();
    if (p.isBot) {
      const delay = 900 + Math.random() * 1300;
      this._timers.bot = setTimeout(() => this.botAct(), delay);
    }
    this.onUpdate();
  }

  advanceTurn(steps = 1) {
    this.turnIndex = this.nextIndex(steps);
    this.beginTurn();
  }

  handleTimeout() {
    if (this.finished || this._destroyed) return;
    const p = this.currentPlayer();
    this.onEvent({ type: 'timeout', playerId: p.id });
    if (this.challenge && this.challenge.victimId === p.id) {
      this.handleChallenge(p.id, false);
      return;
    }
    if (this.pendingDraw > 0) {
      this.acceptPenalty(p);
      return;
    }
    if (this.pendingDrawnCardId) {
      this.handlePass(p.id);
      return;
    }
    // Auto-draw a single card and move on.
    const card = this.takeCard();
    if (card) {
      p.hand.push(card);
      p.stats.drawCardsTaken += 1;
      p.saidUno = false;
      this.onEvent({ type: 'draw', playerId: p.id, count: 1 });
    }
    this.advanceTurn(1);
  }

  // -------------------------------------------------------------- legality

  /**
   * Can `player` legally play `card` right now (ignoring turn order — turn
   * order is validated separately so this can also power jump-in checks)?
   */
  canPlay(player, card) {
    if (this.finished) return false;
    const top = this.top();
    if (!top) return false;

    if (this.pendingDraw > 0) {
      // Only stacking responses are allowed while a draw penalty is live.
      if (card.value === 'draw2' && this.pendingType === 'draw2' && this.rules.stackDraw2) {
        return this.withinStackLimit(2);
      }
      if (card.value === 'wild4') {
        if (this.pendingType === 'wild4' && this.rules.stackDraw4) return this.withinStackLimit(4);
        if (this.pendingType === 'draw2' && this.rules.stackDraw4OnDraw2) return this.withinStackLimit(4);
      }
      return false;
    }

    if (card.value === 'wild') return true;
    if (card.value === 'wild4') {
      if (this.rules.noBluffing) {
        // Official restriction: only legal with no card matching the current color.
        return !player.hand.some((c) => c.id !== card.id && c.color === this.currentColor);
      }
      return true;
    }
    return card.color === this.currentColor || card.value === top.value;
  }

  withinStackLimit(add) {
    return this.rules.stackLimit === 0 || this.pendingDraw + add <= this.rules.stackLimit;
  }

  playableIdsFor(player) {
    if (this.finished || !player) return [];
    const isTurn = this.currentPlayer().id === player.id;
    if (isTurn) {
      if (this.pendingDrawnCardId) {
        const drawn = player.hand.find((c) => c.id === this.pendingDrawnCardId);
        return drawn && this.canPlay(player, drawn) ? [drawn.id] : [];
      }
      return player.hand.filter((c) => this.canPlay(player, c)).map((c) => c.id);
    }
    if (this.rules.jumpIn && !this.challenge) {
      const top = this.top();
      return player.hand
        .filter((c) => c.color !== 'wild' && c.color === top.color && c.value === top.value)
        .map((c) => c.id);
    }
    return [];
  }

  // ----------------------------------------------------------------- play

  handlePlay(playerId, { cardId, color, swapTargetId, declareUno } = {}) {
    if (this.finished) return err('The game is over');
    const player = this.getPlayer(playerId);
    if (!player) return err('You are not in this game');

    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return err("You don't have that card");

    const isTurn = this.currentPlayer().id === playerId;

    if (!isTurn) {
      // Jump-in: identical (color AND value) non-wild card, out of turn.
      const top = this.top();
      const identical = card.color !== 'wild' && card.color === top.color && card.value === top.value;
      if (!this.rules.jumpIn || !identical) return err("It's not your turn");
      if (this.challenge) return err('Waiting on a Draw Four challenge');
      clearTimeout(this._timers.bot);
      this.turnIndex = this.players.indexOf(player);
      this.pendingDrawnCardId = null;
      this.onEvent({ type: 'jumpIn', playerId });
    } else if (this.pendingDrawnCardId && cardId !== this.pendingDrawnCardId) {
      return err('You may only play the card you just drew');
    }

    if (!this.canPlay(player, card)) {
      if (this.pendingDraw > 0) return err(`You must stack or draw ${this.pendingDraw}`);
      return err("That card can't be played right now");
    }

    // Wild cards must arrive with a color choice.
    if (card.color === 'wild' && !COLORS.includes(color)) {
      return err('Choose a color for your wild card');
    }
    // Seven-zero: a 7 must arrive with a swap target.
    let swapTarget = null;
    if (this.rules.sevenZero && card.value === '7' && this.players.length > 1) {
      swapTarget = this.getPlayer(swapTargetId);
      if (!swapTarget || swapTarget.id === playerId) return err('Choose a player to swap hands with');
    }

    // ----- the play is legal: commit -----
    const prevColor = this.currentColor;
    // Playing while a challenge prompt is open (i.e. stacking a +4) resolves it.
    this.challenge = null;
    this.pendingDrawnCardId = null;

    player.hand.splice(player.hand.indexOf(card), 1);
    this.discard.push(card);
    player.stats.cardsPlayed += 1;
    this.currentColor = card.color === 'wild' ? color : card.color;
    this.onEvent({ type: 'play', playerId, card, color: this.currentColor });

    // UNO bookkeeping
    if (player.hand.length === 1) {
      if (declareUno) {
        player.saidUno = true;
        player.stats.unoCalls += 1;
        this.onEvent({ type: 'uno', playerId });
      } else if (!player.saidUno) {
        this.makeUnoVulnerable(player);
      }
    } else {
      player.saidUno = false;
    }

    if (player.hand.length === 0) {
      this.endGame(player);
      return ACTION_OK;
    }

    // Card effects
    let steps = 1;
    switch (card.value) {
      case 'skip':
        steps = 2;
        this.onEvent({ type: 'skip', playerId: this.players[this.nextIndex(1)].id });
        break;
      case 'reverse':
        this.direction *= -1;
        if (this.players.length === 2) steps = 2; // reverse acts as skip heads-up
        this.onEvent({ type: 'reverse', direction: this.direction });
        break;
      case 'draw2':
        this.pendingDraw += 2;
        this.pendingType = 'draw2';
        break;
      case 'wild4': {
        this.pendingDraw += 4;
        this.pendingType = 'wild4';
        if (this.rules.challengeDrawFour) {
          // Was it legal? Illegal if the player still holds the previous color.
          const wasLegal = !player.hand.some((c) => c.color === prevColor);
          const victim = this.players[this.nextIndex(1)];
          this.challenge = { victimId: victim.id, offenderId: player.id, wasLegal };
        }
        break;
      }
      case '7':
        if (swapTarget) {
          const mine = player.hand;
          player.hand = swapTarget.hand;
          swapTarget.hand = mine;
          for (const p of [player, swapTarget]) {
            p.saidUno = p.hand.length === 1; // swapped into UNO: no penalty window
            p.unoVulnerableUntil = 0;
          }
          this.onEvent({ type: 'swap', playerId, targetId: swapTarget.id });
        }
        break;
      case '0':
        if (this.rules.sevenZero && this.players.length > 2) {
          const hands = this.players.map((p) => p.hand);
          for (let i = 0; i < this.players.length; i++) {
            const from = ((i - this.direction) % this.players.length + this.players.length) % this.players.length;
            this.players[i].hand = hands[from];
          }
          for (const p of this.players) {
            p.saidUno = p.hand.length === 1;
            p.unoVulnerableUntil = 0;
          }
          this.onEvent({ type: 'rotate', direction: this.direction });
        }
        break;
    }

    this.advanceTurn(steps);
    return ACTION_OK;
  }

  // ----------------------------------------------------------------- draw

  handleDraw(playerId) {
    if (this.finished) return err('The game is over');
    const player = this.getPlayer(playerId);
    if (!player) return err('You are not in this game');
    if (this.currentPlayer().id !== playerId) return err("It's not your turn");

    // Drawing while a penalty is live (or a challenge is open) accepts it.
    if (this.pendingDraw > 0) {
      this.challenge = null;
      this.acceptPenalty(player);
      return ACTION_OK;
    }
    if (this.pendingDrawnCardId) return err('You already drew — play it or pass');

    const drawn = [];
    let card = this.takeCard();
    if (!card) { this.advanceTurn(1); return ACTION_OK; }
    player.hand.push(card);
    drawn.push(card);

    if (this.rules.drawUntilPlayable) {
      let guard = 0;
      while (!this.canPlay(player, card) && guard < 200) {
        const next = this.takeCard();
        if (!next) break;
        player.hand.push(next);
        drawn.push(next);
        card = next;
        guard++;
      }
    }

    player.stats.drawCardsTaken += drawn.length;
    player.saidUno = false;
    player.unoVulnerableUntil = 0;
    this.onEvent({ type: 'draw', playerId, count: drawn.length });

    if (this.canPlay(player, card)) {
      if (this.rules.forcePlay) {
        const move = { cardId: card.id };
        if (card.color === 'wild') move.color = this.mostCommonColor(player);
        if (this.rules.sevenZero && card.value === '7') {
          const others = this.players.filter((p) => p.id !== playerId);
          move.swapTargetId = others.sort((a, b) => a.hand.length - b.hand.length)[0]?.id;
        }
        this.onEvent({ type: 'forcePlay', playerId });
        return this.handlePlay(playerId, move);
      }
      // Let the player decide: play the drawn card or pass.
      this.pendingDrawnCardId = card.id;
      this.onUpdate();
      if (player.isBot) {
        clearTimeout(this._timers.bot);
        this._timers.bot = setTimeout(() => this.botAct(), 700 + Math.random() * 800);
      }
      return ACTION_OK;
    }

    this.advanceTurn(1);
    return ACTION_OK;
  }

  mostCommonColor(player) {
    const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
    for (const c of player.hand) if (c.color !== 'wild') counts[c.color]++;
    return COLORS.slice().sort((a, b) => counts[b] - counts[a])[0];
  }

  acceptPenalty(player) {
    const count = this.pendingDraw;
    this.pendingDraw = 0;
    this.pendingType = null;
    this.challenge = null;
    this.giveCards(player, count);
    this.onEvent({ type: 'penalty', playerId: player.id, count });
    this.advanceTurn(1);
  }

  handlePass(playerId) {
    if (this.finished) return err('The game is over');
    if (this.currentPlayer().id !== playerId) return err("It's not your turn");
    if (!this.pendingDrawnCardId) return err("You can't pass without drawing");
    this.pendingDrawnCardId = null;
    this.advanceTurn(1);
    return ACTION_OK;
  }

  // ------------------------------------------------------------ UNO calls

  makeUnoVulnerable(player) {
    player.unoVulnerableUntil = Date.now() + this.rules.unoTime * 1000;
    this.onEvent({ type: 'unoWindow', playerId: player.id, until: player.unoVulnerableUntil });

    // Refresh state when the window closes so the catch button disappears.
    const t = setTimeout(() => {
      if (!this._destroyed && !this.finished) this.onUpdate();
    }, this.rules.unoTime * 1000 + 200);
    this._timers.uno.push(t);

    // Sharp-eyed bots may catch the player.
    for (const bot of this.players.filter((p) => p.isBot && p.id !== player.id)) {
      if (Math.random() < botCatchChance(bot.difficulty)) {
        const delay = 800 + Math.random() * (this.rules.unoTime * 700);
        this._timers.uno.push(setTimeout(() => {
          if (!this._destroyed && !this.finished) this.handleCatch(bot.id, player.id);
        }, delay));
      }
    }
  }

  handleUno(playerId) {
    if (this.finished) return err('The game is over');
    const player = this.getPlayer(playerId);
    if (!player) return err('You are not in this game');
    if (player.hand.length > 2) return err('You can only call UNO with 2 or fewer cards');
    if (player.saidUno) return ACTION_OK;
    player.saidUno = true;
    player.unoVulnerableUntil = 0;
    player.stats.unoCalls += 1;
    this.onEvent({ type: 'uno', playerId });
    this.onUpdate();
    return ACTION_OK;
  }

  handleCatch(callerId, targetId) {
    if (this.finished) return err('The game is over');
    const caller = this.getPlayer(callerId);
    const target = this.getPlayer(targetId);
    if (!caller || !target) return err('Invalid player');
    if (callerId === targetId) return err("You can't catch yourself");
    if (target.saidUno || target.hand.length !== 1 || target.unoVulnerableUntil <= Date.now()) {
      return err('Too late — nothing to catch');
    }
    target.unoVulnerableUntil = 0;
    this.giveCards(target, this.rules.unoPenalty);
    this.onEvent({ type: 'caught', playerId: targetId, by: callerId, count: this.rules.unoPenalty });
    this.onUpdate();
    return ACTION_OK;
  }

  // ------------------------------------------------------------ challenges

  handleChallenge(playerId, accept) {
    if (this.finished) return err('The game is over');
    if (!this.challenge) return err('There is nothing to challenge');
    if (this.challenge.victimId !== playerId) return err("This challenge isn't yours to make");
    const victim = this.getPlayer(playerId);
    const offender = this.getPlayer(this.challenge.offenderId);
    const { wasLegal } = this.challenge;
    this.challenge = null;

    if (!accept) {
      // Declined: take the penalty.
      this.acceptPenalty(victim);
      return ACTION_OK;
    }

    this.onEvent({ type: 'challenge', by: playerId, against: offender?.id, success: !wasLegal });
    if (!wasLegal && offender) {
      // Guilty: offender swallows the whole stack, challenger keeps the turn.
      const count = this.pendingDraw;
      this.pendingDraw = 0;
      this.pendingType = null;
      this.giveCards(offender, count);
      this.onEvent({ type: 'penalty', playerId: offender.id, count });
      this.beginTurn(); // still the victim's turn
    } else {
      // Innocent: challenger draws the stack plus two.
      const count = this.pendingDraw + 2;
      this.pendingDraw = 0;
      this.pendingType = null;
      this.giveCards(victim, count);
      this.onEvent({ type: 'penalty', playerId: victim.id, count });
      this.advanceTurn(1);
    }
    return ACTION_OK;
  }

  // -------------------------------------------------------------- bot glue

  botAct() {
    if (this.finished || this._destroyed) return;
    const bot = this.currentPlayer();
    if (!bot.isBot) return;
    const move = decideBotTurn(this, bot);
    let result;
    switch (move.action) {
      case 'play': result = this.handlePlay(bot.id, move); break;
      case 'draw': result = this.handleDraw(bot.id); break;
      case 'pass': result = this.handlePass(bot.id); break;
      case 'challenge': result = this.handleChallenge(bot.id, move.accept); break;
    }
    // If the bot somehow chose an illegal move, fall back to drawing so the
    // game can never stall.
    if (result && !result.ok) {
      if (this.pendingDrawnCardId) this.handlePass(bot.id);
      else this.handleDraw(bot.id);
    }
  }

  // -------------------------------------------------------------- end game

  endGame(winner) {
    this.finished = true;
    this.winnerId = winner.id;
    clearTimeout(this._timers.turn);
    clearTimeout(this._timers.bot);
    for (const t of this._timers.uno) clearTimeout(t);

    const losers = this.players
      .filter((p) => p.id !== winner.id)
      .sort((a, b) => a.hand.length - b.hand.length);
    const score = losers.reduce((sum, p) => sum + p.hand.reduce((s, c) => s + cardPoints(c), 0), 0);

    this.ranking = [
      { place: 1, id: winner.id, name: winner.name, isBot: winner.isBot, cardsLeft: 0, score },
      ...losers.map((p, i) => ({
        place: i + 2,
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        cardsLeft: p.hand.length,
        score: 0
      }))
    ];

    this.onEvent({ type: 'win', playerId: winner.id });
    this.onUpdate();
    this.onFinish({
      winnerId: winner.id,
      ranking: this.ranking,
      durationMs: Date.now() - this.startedAt,
      playerStats: Object.fromEntries(this.players.map((p) => [p.id, { ...p.stats, isBot: p.isBot, name: p.name }]))
    });
  }

  setConnected(playerId, connected) {
    const p = this.getPlayer(playerId);
    if (p) {
      p.connected = connected;
      this.onUpdate();
    }
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._timers.turn);
    clearTimeout(this._timers.bot);
    for (const t of this._timers.uno) clearTimeout(t);
  }

  // ------------------------------------------------------------- snapshots

  /**
   * Personalized, sanitized snapshot. `viewerId === null` → spectator view
   * (no hidden information at all).
   */
  stateFor(viewerId) {
    const viewer = viewerId ? this.getPlayer(viewerId) : null;
    const now = Date.now();
    return {
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        difficulty: p.isBot ? p.difficulty : undefined,
        connected: p.connected,
        handCount: p.hand.length,
        saidUno: p.saidUno,
        unoVulnerable: p.unoVulnerableUntil > now,
        isTurn: i === this.turnIndex && !this.finished
      })),
      yourHand: viewer ? viewer.hand : [],
      playableIds: viewer ? this.playableIdsFor(viewer) : [],
      pendingDrawnCardId:
        viewer && this.currentPlayer().id === viewer.id ? this.pendingDrawnCardId : null,
      discardTop: this.top() || null,
      currentColor: this.currentColor,
      direction: this.direction,
      drawPileCount: this.drawPile.length,
      pendingDraw: this.pendingDraw,
      pendingType: this.pendingType,
      challenge: this.challenge
        ? { victimId: this.challenge.victimId, offenderId: this.challenge.offenderId }
        : null,
      turnPlayerId: this.finished ? null : this.currentPlayer().id,
      turnEndsAt: this.turnDeadline,
      finished: this.finished,
      winnerId: this.winnerId,
      ranking: this.ranking,
      rules: this.rules
    };
  }
}
