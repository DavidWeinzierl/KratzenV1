import { PLAYER_STATUS, GAME_PHASE, getCardImageFilename, WELI_RANK, EXCHANGE_TYPE, BID_OPTIONS } from './constants.js';
import {
    nextStep,
    handleUserBid,
    areOtherPlayersCardsHidden,
    selectedCardsForManualAction,
    handleManualCardSelectionForDiscardExchange,
    handleConfirmManualDiscard,
    handleManualExchangeTypeSelection,
    handleConfirmManualStandardExchange,
    handleManualCardPlay,
    isManualBiddingMode,
    isSimulationRunning
} from './controller.js';
import { GameRules } from './gameLogic.js';
import { logMessage as importedLogMessageForUI } from './logger.js';

function logUIMessage(message) {
    if (typeof importedLogMessageForUI === 'function' && !isSimulationRunning) { importedLogMessageForUI(message); } 
    else if (!isSimulationRunning) { console.log("UI LOG:", message); }
}

export function getElementCoordinates(elementSelectorOrElement) {
    const gameBoard = document.getElementById('game-board');
    if (!gameBoard) { console.error("getElementCoordinates: #game-board not found!"); return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
    const gameBoardRect = gameBoard.getBoundingClientRect();
    let element = typeof elementSelectorOrElement === 'string' ? document.querySelector(elementSelectorOrElement) : elementSelectorOrElement;
    if (!element) {
        const cardWidth = 72, cardHeight = 108;
        return { top: gameBoardRect.height / 2 - (cardHeight / 2), left: gameBoardRect.width / 2 - (cardWidth / 2), width: cardWidth, height: cardHeight, right: gameBoardRect.width / 2 + (cardWidth / 2), bottom: gameBoardRect.height / 2 + (cardHeight / 2) };
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top - gameBoardRect.top, left: rect.left - gameBoardRect.left, width: rect.width, height: rect.height, right: rect.right - gameBoardRect.left, bottom: rect.bottom - gameBoardRect.top };
}

export function animateCardMovement(sourceSelectorOrCoords, destinationSelectorOrCoords, cardToAnimate, animationSpeed, options = {}) {
    if (isSimulationRunning) { return Promise.resolve(); }
    return new Promise(resolve => {
        const gameBoard = document.getElementById('game-board');
        if (!gameBoard) { console.error("animateCardMovement: #game-board not found!"); resolve(); return; }
        let sourceCoords = (typeof sourceSelectorOrCoords === 'object' && sourceSelectorOrCoords !== null && 'top' in sourceSelectorOrCoords) ? sourceSelectorOrCoords : getElementCoordinates(sourceSelectorOrCoords);
        let destCoordsTarget;
        if (typeof destinationSelectorOrCoords === 'object' && destinationSelectorOrCoords !== null && 'top' in destinationSelectorOrCoords) { destCoordsTarget = destinationSelectorOrCoords; } 
        else {
            const destElementRect = getElementCoordinates(destinationSelectorOrCoords);
            if (options.isPlayingToTrick) { destCoordsTarget = { top: destElementRect.top + (destElementRect.height / 2) - (108 / 2), left: destElementRect.left + (destElementRect.width / 2) - (72 / 2) }; } 
            else if (options.isDealing) { const cardWidthWithGap = 72 + 5; destCoordsTarget = { top: destElementRect.top + (destElementRect.height / 2) - (108 / 2), left: destElementRect.left + 5 + ((options.cardIndexInHand || 0) * cardWidthWithGap) }; } 
            else { destCoordsTarget = { top: destElementRect.top + (destElementRect.height / 2) - (108 / 2), left: destElementRect.left + (destElementRect.width / 2) - (72 / 2) }; }
        }
        const flyingCard = document.createElement('img');
        flyingCard.classList.add('card-image', 'flying-card');
        if (options.isDealing || options.isDiscard || !cardToAnimate) { flyingCard.src = `img/${getCardImageFilename(null)}`; flyingCard.alt = "Card Back Flying"; } 
        else { flyingCard.src = `img/${getCardImageFilename(cardToAnimate)}`; flyingCard.alt = cardToAnimate ? cardToAnimate.toString() + " Flying" : "Card Face Flying"; }
        flyingCard.style.left = sourceCoords.left + 'px';
        flyingCard.style.top = sourceCoords.top + 'px';
        flyingCard.style.transitionDuration = animationSpeed + 's';
        gameBoard.appendChild(flyingCard);
        void flyingCard.offsetWidth;
        flyingCard.style.transform = `translate(${destCoordsTarget.left - sourceCoords.left}px, ${destCoordsTarget.top - sourceCoords.top}px)`;
        flyingCard.addEventListener('transitionend', () => {
            if (options.revealAtEnd && cardToAnimate) {
                flyingCard.src = `img/${getCardImageFilename(cardToAnimate)}`;
                flyingCard.alt = cardToAnimate.toString();
                setTimeout(() => { if (document.body.contains(flyingCard)) flyingCard.remove(); resolve(); }, 50);
            } else { if (document.body.contains(flyingCard)) flyingCard.remove(); resolve(); }
        }, { once: true });
        setTimeout(() => { if (document.body.contains(flyingCard)) { flyingCard.remove(); resolve(); } }, animationSpeed * 1000 + 200);
    });
}

function createCardElement(cardData, isSelectable = false, isSelected = false, isPlayable = false) {
    const imgElement = document.createElement('img');
    imgElement.classList.add('card-image');
    imgElement.src = `img/${getCardImageFilename(cardData)}`;
    imgElement.alt = cardData ? cardData.toString() : "Card Back";
    imgElement.title = cardData ? (cardData.rank === WELI_RANK ? 'Weli' : `${cardData.rank} of ${cardData.suit}`) : 'Card Back';
    if (isSelectable || isPlayable) { imgElement.classList.add('manual-playable'); }
    if (isSelected) { imgElement.classList.add('card-selected'); }
    imgElement.onerror = function() { console.error(`Failed to load image: ${this.src}`); this.alt = `Error loading ${this.alt}`; this.style.border = '2px solid red'; };
    return imgElement;
}

export function renderGame(gameState) {
    if (isSimulationRunning) { return; }
    const dynamicButtonsMasterContainer = document.getElementById('dynamic-buttons-master-container');
    if (!gameState) {
        logUIMessage("Game not initialized. Click 'Start Game' to begin.");
        if (dynamicButtonsMasterContainer) { dynamicButtonsMasterContainer.innerHTML = ''; }
        const trumpCardDisplayEl = document.getElementById('trump-card-display');
        if (trumpCardDisplayEl) {
            trumpCardDisplayEl.innerHTML = '';
            const cardPlaceholder = document.createElement('div'); cardPlaceholder.classList.add('card-image-placeholder'); trumpCardDisplayEl.appendChild(cardPlaceholder);
            const placeholderLabel = document.createElement('div'); placeholderLabel.classList.add('trump-suit-label'); placeholderLabel.textContent = 'Trumpf'; trumpCardDisplayEl.appendChild(placeholderLabel);
        }
        const talonDisplayEl = document.getElementById('talon-display');
        if (talonDisplayEl) {
            talonDisplayEl.innerHTML = '';
            const talonCardBackImg = createCardElement(null); talonDisplayEl.appendChild(talonCardBackImg);
            const talonCountLabel = document.createElement('div'); talonCountLabel.classList.add('talon-count-label'); talonCountLabel.textContent = `Talon: 33`; talonDisplayEl.appendChild(talonCountLabel);
        }
        return;
    }
    if (dynamicButtonsMasterContainer) { dynamicButtonsMasterContainer.innerHTML = ''; } 
    else { console.error("#dynamic-buttons-master-container not found!"); return; }

    const manualPlayerId = 0;
    const isP0TurnForManualAction = isManualBiddingMode && gameState.turnPlayerIndex === manualPlayerId;

    gameState.players.forEach((player, index) => {
        const playerArea = document.getElementById(`player-area-${index}`);
        if (!playerArea) return;
        playerArea.innerHTML = '';
        const infoDiv = document.createElement('div'); infoDiv.classList.add('player-info');
        let dealerIndicator = (player.id === gameState.dealerIndex) ? ' <span class="dealer-indicator">DEALER</span>' : '';
        const playerNameHTML = `<p>${player.name} (P${player.id})${dealerIndicator}</p>`;
        const statusHTML = `<p>${player.status}</p>`;
        const pointsHTML = `<p>Punkte: ${player.points.toFixed(1)}</p>`;
        let trickDisplay = player.tricksWonThisRound > 0 ? `<span class="tricks-highlight">${player.tricksWonThisRound}</span>` : player.tricksWonThisRound;
        const tricksHTML = `<p>Stiche: ${trickDisplay}</p>`;
        const bidHTML = `<p>Spielzug: ${player.currentBid || ''}</p>`;
        let actionText = player.lastActionLog || '-';
        const isP0Waiting = player.id === manualPlayerId && isP0TurnForManualAction && (gameState.isWaitingForBidInput || gameState.isWaitingForManualPlay || gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection);
        if (player.id === gameState.turnPlayerIndex && !isP0Waiting && !gameState.isAnimating) {
            switch(gameState.phase) {
                case GAME_PHASE.BIDDING_STAGE_1: case GAME_PHASE.BIDDING_STAGE_2: actionText = "Wos duast?"; break;
                case GAME_PHASE.EXCHANGE: actionText = "Austauschen..."; break;
                case GAME_PHASE.FINAL_DISCARD: case GAME_PHASE.DEALER_DISCARD: case GAME_PHASE.EXCHANGE_PREP: actionText = "Wegwerfen..."; break;
                case GAME_PHASE.PLAYING_TRICKS: actionText = "I spü..."; break;
                default: actionText = player.lastActionLog || '-';
            }
        } else if (isP0Waiting) { actionText = "Wos duast?"; } 
        else if (gameState.isAnimating && player.id === gameState.turnPlayerIndex) { actionText = "..."; } 
        else if (gameState.phase === GAME_PHASE.ROUND_END || gameState.phase === GAME_PHASE.SETUP) { actionText = player.lastActionLog || "..."; } 
        else if ((gameState.phase === GAME_PHASE.SCORING || gameState.phase === GAME_PHASE.ALL_WEITER_PENALTY) && !player.lastActionLog.includes(')')) { actionText = "Punktevergabe..."; }
        const actionHTML = `<p class="player-action-log">${actionText}</p>`;
        infoDiv.innerHTML = playerNameHTML + statusHTML + pointsHTML + tricksHTML + bidHTML + actionHTML;
        playerArea.appendChild(infoDiv);

        const handDiv = document.createElement('div'); handDiv.classList.add('player-hand');
        playerArea.appendChild(handDiv);
        const hand = player.hand || [];
        const cardCount = hand.length;
        if (cardCount === 0) { return; }
        
        const fanThreshold = 5;
        const needsFanning = cardCount >= fanThreshold;
        let p0CardsAreSelectable = false, p0CardsArePlayableNow = false, validPlaysForP0 = [];
        if (player.id === manualPlayerId && isP0TurnForManualAction) {
            if (gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeCardSelection) { p0CardsAreSelectable = true; } 
            else if (gameState.isWaitingForManualPlay) { p0CardsArePlayableNow = true; validPlaysForP0 = GameRules.getValidPlays(gameState, player); }
        }
        
        const cardElements = [];
        hand.forEach((cardData) => {
            if (cardData) {
                const showFace = player.id === manualPlayerId || !areOtherPlayersCardsHidden;
                const cardToDisplay = showFace ? cardData : null;
                let isThisCardSelected = false, isThisCardPlayableByRule = false;
                if (player.id === manualPlayerId && isP0TurnForManualAction) {
                    if (p0CardsAreSelectable && selectedCardsForManualAction) { isThisCardSelected = selectedCardsForManualAction.some(selCard => selCard.key === cardData.key); }
                    if (p0CardsArePlayableNow) { isThisCardPlayableByRule = validPlaysForP0.some(vp => vp.key === cardData.key); }
                }
                const cardEl = createCardElement(cardToDisplay, p0CardsAreSelectable, isThisCardSelected, isThisCardPlayableByRule);
                if (player.id === manualPlayerId && isP0TurnForManualAction) {
                    if (p0CardsAreSelectable) { cardEl.addEventListener('click', () => handleManualCardSelectionForDiscardExchange(cardData)); } 
                    else if (p0CardsArePlayableNow && isThisCardPlayableByRule) { cardEl.addEventListener('click', () => handleManualCardPlay(cardData)); }
                }
                handDiv.appendChild(cardEl);
                cardElements.push(cardEl);
            } else { console.warn(`Player ${player.name} has an invalid card in hand.`); }
        });

        if (needsFanning && cardElements.length > 0) {
            const cardWidth = cardElements[0].offsetWidth;
            const handContainerWidth = handDiv.offsetWidth;
            if (handContainerWidth > 0 && cardWidth > 0) {
                const fanningRightMargin = 15;
                const minVisiblePartOfCard = cardWidth * 0.25;
                let cardSpacing = (handContainerWidth - cardWidth - fanningRightMargin) / (cardCount - 1);
                cardSpacing = Math.max(cardSpacing, minVisiblePartOfCard);
                cardElements.forEach((cardEl, i) => {
                    cardEl.style.position = 'absolute';
                    cardEl.style.bottom = '0px';
                    cardEl.style.zIndex = i;
                    cardEl.style.left = `${i * cardSpacing}px`;
                });
            } else { logUIMessage(`Warning: Could not get valid width for hand/card to apply fanning for ${player.name}.`); }
        }
    });

    const trumpCardDisplayEl = document.getElementById('trump-card-display');
    const talonDisplayEl = document.getElementById('talon-display');
    if (trumpCardDisplayEl && talonDisplayEl) {
        trumpCardDisplayEl.innerHTML = '';
        if (gameState.originalTrumpCard && gameState.originalTrumpCard.rank === WELI_RANK && gameState.trumpCard) {
            const weliEl = createCardElement(gameState.originalTrumpCard); weliEl.classList.add('trump-card-stacked', 'bottom-card');
            const actualTrumpEl = createCardElement(gameState.trumpCard); actualTrumpEl.classList.add('trump-card-stacked', 'top-card');
            trumpCardDisplayEl.appendChild(weliEl);
            trumpCardDisplayEl.appendChild(actualTrumpEl);
        } else if (gameState.trumpCard && gameState.trumpSuit) { const cardEl = createCardElement(gameState.trumpCard); trumpCardDisplayEl.appendChild(cardEl); } 
        else { const cardPlaceholder = document.createElement('div'); cardPlaceholder.classList.add('card-image-placeholder'); trumpCardDisplayEl.appendChild(cardPlaceholder); }
        const suitLabel = document.createElement('div'); suitLabel.classList.add('trump-suit-label'); suitLabel.textContent = 'Trumpf'; trumpCardDisplayEl.appendChild(suitLabel);
        
        talonDisplayEl.innerHTML = '';
        const talonCardBackImg = createCardElement(null); talonDisplayEl.appendChild(talonCardBackImg);
        const talonCountLabel = document.createElement('div'); talonCountLabel.classList.add('talon-count-label');
        let talonCountToShow = 0;
        if (gameState.phase === GAME_PHASE.SETUP || (gameState.phase === GAME_PHASE.ROUND_END && gameState.deck && !gameState.deck.isEmpty()) || gameState.phase === GAME_PHASE.ANTE) { talonCountToShow = gameState.deck ? gameState.deck.cards.length : 33; } 
        else if (gameState.phase === GAME_PHASE.DEALING) { talonCountToShow = gameState.deck ? gameState.deck.remaining : 0; } 
        else { talonCountToShow = gameState.talon ? gameState.talon.length : 0; }
        talonCountLabel.textContent = `Stoß: ${talonCountToShow}`;
        talonDisplayEl.appendChild(talonCountLabel);
    } else { console.warn("Could not find #trump-card-display or #talon-display."); }

    const trickArea = document.getElementById('trick-area');
    trickArea.innerHTML = '';
    (gameState.currentTrick || []).forEach((play) => {
        if (play && play.card && play.player) {
            const cardContainer = document.createElement('div'); cardContainer.classList.add('trick-card-container');
            const cardEl = createCardElement(play.card); cardContainer.appendChild(cardEl);
            const playerIndicator = document.createElement('span'); playerIndicator.classList.add('trick-card-player'); playerIndicator.textContent = `P${play.player.id}`; cardContainer.appendChild(playerIndicator);
            trickArea.appendChild(cardContainer);
        } else { console.warn("Invalid play object in currentTrick."); }
    });

    document.querySelectorAll('.player-area.turn-highlight').forEach(el => el.classList.remove('turn-highlight'));
    const isP0ActuallyWaiting = isP0TurnForManualAction && (gameState.isWaitingForBidInput || gameState.isWaitingForManualPlay || gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection);
    if (gameState.turnPlayerIndex !== -1 && gameState.players[gameState.turnPlayerIndex] && !gameState.isAnimating && !isP0ActuallyWaiting && gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SETUP && gameState.phase !== GAME_PHASE.SCORING && gameState.phase !== GAME_PHASE.ALL_WEITER_PENALTY && gameState.phase !== GAME_PHASE.RESOLVE_ODER && gameState.phase !== GAME_PHASE.TRICK_END) {
        const turnPlayerArea = document.getElementById(`player-area-${gameState.turnPlayerIndex}`);
        if (turnPlayerArea) turnPlayerArea.classList.add('turn-highlight');
    } else if (isP0ActuallyWaiting) { const p0Area = document.getElementById(`player-area-${manualPlayerId}`); if (p0Area) p0Area.classList.add('turn-highlight'); }

    let p0NeedsToMakeChoice = false;
    if (isP0TurnForManualAction) {
        if (gameState.isWaitingForBidInput && gameState.pendingValidBids.length > 0) {
            p0NeedsToMakeChoice = true;
            gameState.pendingValidBids.forEach(bidOption => {
                const button = document.createElement('button'); button.textContent = bidOption; button.classList.add('action-button');
                button.addEventListener('click', () => handleUserBid(bidOption)); dynamicButtonsMasterContainer.appendChild(button);
            });
        } else if (gameState.isWaitingForManualDiscardSelection) {
            p0NeedsToMakeChoice = true;
            const button = document.createElement('button'); button.textContent = 'Karte Wegwerfen (Karte wählen)'; button.classList.add('confirm-action-button');
            button.disabled = !selectedCardsForManualAction || selectedCardsForManualAction.length !== gameState.numCardsToDiscardManually;
            button.addEventListener('click', handleConfirmManualDiscard); dynamicButtonsMasterContainer.appendChild(button);
        } else if (gameState.isWaitingForManualExchangeChoice) {
            p0NeedsToMakeChoice = true;
            const playerP0 = gameState.players[manualPlayerId];
            const validExchangeOpts = GameRules.getValidExchangeOptions(playerP0, gameState.trumpSuit);
            const hasSauOpt = validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.SAU), hasStandardOpt = validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.STANDARD), hasNormalPackerlOpt = validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.NORMAL_PACKERL);
            const hideStandardBecauseOnlyNormalPackerlIsBetter = validExchangeOpts.length === 2 && hasStandardOpt && hasNormalPackerlOpt;
            if (hideStandardBecauseOnlyNormalPackerlIsBetter) { logUIMessage("UI: Standard Exchange option hidden as Normales Packerl is the preferred/enforced choice."); }
            if (hasSauOpt) { logUIMessage("UI: Standard Exchange option hidden as '4 auf die Sau' is available and mandatory."); }
            validExchangeOpts.forEach(opt => {
                let buttonText = '', createThisButton = true;
                switch (opt.type) {
                    case EXCHANGE_TYPE.STANDARD: buttonText = 'Karten kaufen'; if (hideStandardBecauseOnlyNormalPackerlIsBetter || hasSauOpt) { createThisButton = false; } break;
                    case EXCHANGE_TYPE.SAU: buttonText = '4 auf die Sau'; break;
                    case EXCHANGE_TYPE.TRUMPF_PACKERL: buttonText = 'Trumpf-Packerl'; break;
                    case EXCHANGE_TYPE.NORMAL_PACKERL: buttonText = 'Normales-Packerl'; break;
                    default: createThisButton = false; console.warn("Unknown exchange type:", opt.type);
                }
                if (createThisButton) {
                    const button = document.createElement('button'); button.textContent = buttonText; button.classList.add('action-button');
                    button.dataset.exchangeType = opt.type; button.addEventListener('click', () => handleManualExchangeTypeSelection(opt.type));
                    dynamicButtonsMasterContainer.appendChild(button);
                }
            });
        } else if (gameState.isWaitingForManualExchangeCardSelection) {
            p0NeedsToMakeChoice = true;
            const button = document.createElement('button'); button.textContent = 'Karten wegwerfen (Karten wählen)'; button.classList.add('confirm-action-button');
            const cardsSelectedCount = selectedCardsForManualAction ? selectedCardsForManualAction.length : 0;
            button.disabled = cardsSelectedCount < 0 || cardsSelectedCount > 4;
            button.addEventListener('click', handleConfirmManualStandardExchange); dynamicButtonsMasterContainer.appendChild(button);
        } else if (gameState.isWaitingForManualPlay) {
            p0NeedsToMakeChoice = true;
            const hintButton = document.createElement('button'); hintButton.textContent = "Click on card to play"; hintButton.classList.add('action-button'); hintButton.disabled = true;
            dynamicButtonsMasterContainer.appendChild(hintButton);
        }
    }

    if (!p0NeedsToMakeChoice && gameState.phase !== GAME_PHASE.ROUND_END) {
        const nextStepBtn = document.createElement('button'); nextStepBtn.textContent = "Next Step (Space)";
        nextStepBtn.id = 'dynamic-next-step'; nextStepBtn.classList.add('action-button', 'next-step-button-actionarea');
        nextStepBtn.addEventListener('click', nextStep); nextStepBtn.disabled = gameState.isAnimating;
        dynamicButtonsMasterContainer.appendChild(nextStepBtn);
    } else if (gameState.phase === GAME_PHASE.ROUND_END && !isSimulationRunning) {
        const nextStepBtn = document.createElement('button'); nextStepBtn.textContent = "Start New Round";
        nextStepBtn.id = 'dynamic-next-step'; nextStepBtn.classList.add('action-button', 'next-step-button-actionarea');
        nextStepBtn.addEventListener('click', nextStep); nextStepBtn.disabled = gameState.isAnimating;
        dynamicButtonsMasterContainer.appendChild(nextStepBtn);
    }
}