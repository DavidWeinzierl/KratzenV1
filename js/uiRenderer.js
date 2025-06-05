import { PLAYER_STATUS, GAME_PHASE, getCardImageFilename, WELI_RANK, EXCHANGE_TYPE, BID_OPTIONS } from './constants.js';
import {
    handleUserBid,
    isSimulationRunning,
    areOtherPlayersCardsHidden,
    // gameState (implicit, passed to renderGame)
    // --- NEW IMPORTS NEEDED FROM CONTROLLER ---
    // Assuming these will be exported from controller.js or accessible via gameState
    // For now, I'll assume they are part of gameState passed to renderGame or directly imported if global
    selectedCardsForManualAction, // Let's assume this is exported from controller
    handleManualCardSelectionForDiscardExchange,
    handleConfirmManualDiscard,
    handleManualExchangeTypeSelection,
    handleConfirmManualStandardExchange,
    handleManualCardPlay,
    isManualBiddingMode // Let's assume this is exported from controller for clarity
} from './controller.js';
import { GameRules } from './gameLogic.js'; // For getting valid options

// --- Animation Helper: Get Absolute Coordinates of an Element ---
export function getElementCoordinates(elementSelectorOrElement) {
    const gameBoard = document.getElementById('game-board');
    if (!gameBoard) {
        console.error("getElementCoordinates: #game-board not found!");
        return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 };
    }
    const gameBoardRect = gameBoard.getBoundingClientRect();

    let element;
    if (typeof elementSelectorOrElement === 'string') {
        element = document.querySelector(elementSelectorOrElement);
    } else {
        element = elementSelectorOrElement;
    }

    if (!element) {
        const cardWidth = 72;
        const cardHeight = 108;
        return {
            top: gameBoardRect.height / 2 - (cardHeight / 2),
            left: gameBoardRect.width / 2 - (cardWidth / 2),
            width: cardWidth,
            height: cardHeight,
            right: gameBoardRect.width / 2 + (cardWidth / 2),
            bottom: gameBoardRect.height / 2 + (cardHeight / 2)
        };
    }

    const rect = element.getBoundingClientRect();
    return {
        top: rect.top - gameBoardRect.top,
        left: rect.left - gameBoardRect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right - gameBoardRect.left,
        bottom: rect.bottom - gameBoardRect.top
    };
}


// --- Core Animation Function ---
export function animateCardMovement(
    sourceSelectorOrCoords,
    destinationSelectorOrCoords,
    cardToAnimate,
    animationSpeed,
    options = {}
) {
    if (isSimulationRunning) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        const gameBoard = document.getElementById('game-board');
        if (!gameBoard) {
            console.error("animateCardMovement: #game-board not found!");
            resolve();
            return;
        }

        let sourceCoords;
        if (typeof sourceSelectorOrCoords === 'object' && sourceSelectorOrCoords !== null && 'top' in sourceSelectorOrCoords && 'left' in sourceSelectorOrCoords) {
            sourceCoords = sourceSelectorOrCoords;
        } else {
            sourceCoords = getElementCoordinates(sourceSelectorOrCoords);
        }


        let destCoordsTarget;
        if (typeof destinationSelectorOrCoords === 'object' && destinationSelectorOrCoords !== null && 'top' in destinationSelectorOrCoords && 'left' in destinationSelectorOrCoords) {
            destCoordsTarget = destinationSelectorOrCoords;
        } else {
            const destElementRect = getElementCoordinates(destinationSelectorOrCoords);
            if (options.isPlayingToTrick) {
                destCoordsTarget = {
                    top: destElementRect.top + (destElementRect.height / 2) - (108 / 2),
                    left: destElementRect.left + (destElementRect.width / 2) - (72 / 2)
                };
            } else if (options.isDealing) {
                const cardWidthWithGap = 72 + 5;
                destCoordsTarget = {
                    top: destElementRect.top + (destElementRect.height / 2) - (108 / 2),
                    left: destElementRect.left + 5 + ((options.cardIndexInHand || 0) * cardWidthWithGap)
                };
            } else {
                destCoordsTarget = { top: destElementRect.top, left: destElementRect.left };
            }
        }


        const flyingCard = document.createElement('img');
        flyingCard.classList.add('card-image', 'flying-card');

        if (options.isDealing || options.isDiscard || !cardToAnimate) {
            flyingCard.src = `img/${getCardImageFilename(null)}`;
            flyingCard.alt = "Card Back Flying";
        } else {
            flyingCard.src = `img/${getCardImageFilename(cardToAnimate)}`;
            flyingCard.alt = cardToAnimate ? cardToAnimate.toString() + " Flying" : "Card Face Flying";
        }

        flyingCard.style.left = sourceCoords.left + 'px';
        flyingCard.style.top = sourceCoords.top + 'px';
        flyingCard.style.transitionDuration = animationSpeed + 's';

        gameBoard.appendChild(flyingCard);
        void flyingCard.offsetWidth;

        const dX = destCoordsTarget.left - sourceCoords.left;
        const dY = destCoordsTarget.top - sourceCoords.top;
        flyingCard.style.transform = `translate(${dX}px, ${dY}px)`;

        flyingCard.addEventListener('transitionend', () => {
            if (options.revealAtEnd && cardToAnimate) {
                flyingCard.src = `img/${getCardImageFilename(cardToAnimate)}`;
                flyingCard.alt = cardToAnimate.toString();
                setTimeout(() => {
                    if (document.body.contains(flyingCard)) flyingCard.remove();
                    resolve();
                }, 50);
            } else {
                if (document.body.contains(flyingCard)) flyingCard.remove();
                resolve();
            }
        }, { once: true });

        setTimeout(() => {
            if (document.body.contains(flyingCard)) {
                flyingCard.remove();
                resolve();
            }
        }, animationSpeed * 1000 + 200);
    });
}


// Helper to create a card element (Uses IMAGES)
function createCardElement(cardData, isSelectable = false, isSelected = false, isPlayable = false) {
    const imgElement = document.createElement('img');
    imgElement.classList.add('card-image');

    // cardData can be null to show card back
    imgElement.src = `img/${getCardImageFilename(cardData)}`;
    imgElement.alt = cardData ? cardData.toString() : "Card Back";

    if (cardData && cardData.rank !== WELI_RANK) {
        imgElement.title = `${cardData.rank} of ${cardData.suit}`;
    } else if (cardData && cardData.rank === WELI_RANK) {
         imgElement.title = 'Weli';
    } else {
         imgElement.title = 'Card Back';
    }

    if (isSelectable || isPlayable) {
        imgElement.classList.add('manual-playable'); // General style for clickable cards
    }
    if (isSelected) {
        imgElement.classList.add('card-selected');
    }

    imgElement.onerror = function() {
        console.error(`Failed to load image: ${this.src}`);
        this.alt = `Error loading ${this.alt}`;
        this.style.border = '2px solid red';
    };
    return imgElement;
}


export function renderGame(gameState) {
    if (isSimulationRunning) {
        return;
    }

    const logBox = document.getElementById('log-box');
    const nextStepButton = document.getElementById('next-step');

    if (!gameState) {
        // ... (initial setup rendering, unchanged) ...
        console.warn("Render called with null gameState. Displaying initial setup.");
        if (logBox && logBox.innerHTML.trim() === '') {
             typeof logMessage === 'function'
                ? logMessage("Game not initialized. Click 'Next Step' to start.")
                : console.log("Game not initialized. Click 'Next Step' to start.");
        }
        if (nextStepButton) nextStepButton.disabled = false;

        const trumpCardDisplayEl = document.getElementById('trump-card-display');
        if(trumpCardDisplayEl) {
            trumpCardDisplayEl.innerHTML = '';
            const cardPlaceholder = document.createElement('div');
            cardPlaceholder.classList.add('card-image-placeholder');
            trumpCardDisplayEl.appendChild(cardPlaceholder);
            const placeholderLabel = document.createElement('div');
            placeholderLabel.classList.add('trump-suit-label');
            placeholderLabel.textContent = 'Trumpf';
            trumpCardDisplayEl.appendChild(placeholderLabel);
        }

        const talonDisplayEl = document.getElementById('talon-display');
        if(talonDisplayEl) {
            talonDisplayEl.innerHTML = '';
            const talonCardBackImg = createCardElement(null); // Use helper
            talonDisplayEl.appendChild(talonCardBackImg);
            const talonCountLabel = document.createElement('div');
            talonCountLabel.classList.add('talon-count-label');
            talonCountLabel.textContent = `Talon: 33`;
            talonDisplayEl.appendChild(talonCountLabel);
        }
        return;
    }

    // --- Clear dynamic button containers ---
    const bidContainer = document.getElementById('bid-options-container');
    bidContainer.innerHTML = '';
    const manualActionConfirmContainer = document.getElementById('manual-action-confirm-container');
    manualActionConfirmContainer.innerHTML = '';

    // --- Render Player Hands & Info ---
    const manualPlayerId = 0; // Assuming P0 is the manual player
    const isP0ManualTurn = isManualBiddingMode && gameState.turnPlayerIndex === manualPlayerId;

    gameState.players.forEach((player, index) => {
        const playerArea = document.getElementById(`player-area-${index}`);
        if (!playerArea) return;
        playerArea.innerHTML = '';

        const infoDiv = document.createElement('div');
        // ... (player info rendering, unchanged from your previous version) ...
        infoDiv.classList.add('player-info');
        let dealerIndicator = (player.id === gameState.dealerIndex) ? ' <span class="dealer-indicator">DEALER</span>' : '';
        const playerNameHTML = `<p>${player.name} (P${player.id})${dealerIndicator}</p>`;
        const statusHTML = `<p>Status: ${player.status}</p>`;
        const pointsHTML = `<p>Punkte: ${player.points.toFixed(1)}</p>`;
        let trickDisplay = player.tricksWonThisRound > 0 ? `<span class="tricks-highlight">${player.tricksWonThisRound}</span>` : player.tricksWonThisRound;
        const tricksHTML = `<p>Stiche: ${trickDisplay}</p>`;
        const bidHTML = `<p>Spielzug: ${player.currentBid || ''}</p>`;
        let actionText = player.lastActionLog || '-';
         if (player.id === gameState.turnPlayerIndex && !gameState.isWaitingForBidInput && !gameState.isAnimating && !gameState.isWaitingForManualPlay && !gameState.isWaitingForManualDiscardSelection && !gameState.isWaitingForManualExchangeChoice && !gameState.isWaitingForManualExchangeCardSelection) {
             switch(gameState.phase) {
                 case GAME_PHASE.BIDDING_STAGE_1: actionText = "Bidding..."; break;
                 case GAME_PHASE.BIDDING_STAGE_2: actionText = "Bidding..."; break;
                 case GAME_PHASE.EXCHANGE: actionText = "Exchanging..."; break;
                 case GAME_PHASE.FINAL_DISCARD: actionText = "Discarding..."; break;
                 case GAME_PHASE.PLAYING_TRICKS: actionText = "Playing..."; break;
                 case GAME_PHASE.DEALER_DISCARD: actionText = "Discarding..."; break;
                 case GAME_PHASE.EXCHANGE_PREP: actionText = "Discarding..."; break;
                 default: actionText = player.lastActionLog || '-';
             }
        } else if (player.id === gameState.turnPlayerIndex && (gameState.isWaitingForBidInput || gameState.isWaitingForManualPlay || gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection)) {
             actionText = "Waiting for YOUR input...";
        } else if (gameState.isAnimating && player.id === gameState.turnPlayerIndex) {
             actionText = "Animating...";
        } else if (gameState.phase === GAME_PHASE.ROUND_END || gameState.phase === GAME_PHASE.SETUP) {
             actionText = player.lastActionLog || "Waiting...";
        } else if ((gameState.phase === GAME_PHASE.SCORING || gameState.phase === GAME_PHASE.ALL_WEITER_PENALTY) && !player.lastActionLog.includes(')')) {
             actionText = "Scoring...";
         } else {
             actionText = player.lastActionLog || '-';
         }
        const actionHTML = `<p class="player-action-log">${actionText}</p>`;
        infoDiv.innerHTML = playerNameHTML + statusHTML + pointsHTML + tricksHTML + bidHTML + actionHTML;
        playerArea.appendChild(infoDiv);


        const handDiv = document.createElement('div');
        handDiv.classList.add('player-hand');
        const hand = player.hand || [];
        const cardCount = hand.length;
        const fanThreshold = 5;
        const cardWidth = 72;
        const handContainerWidth = 380; // player-hand width

        // Determine if P0's cards are interactive for this specific state
        let p0CardsAreSelectable = false;
        let p0CardsArePlayableNow = false;
        let validPlaysForP0 = [];

        if (player.id === manualPlayerId && isP0ManualTurn) {
            if (gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeCardSelection) {
                p0CardsAreSelectable = true;
            } else if (gameState.isWaitingForManualPlay) {
                p0CardsArePlayableNow = true;
                validPlaysForP0 = GameRules.getValidPlays(gameState, player);
            }
        }

        if (cardCount > 0) {
            // Simplified fanning logic, can be restored if complex fanning is critical
            hand.forEach((cardData, i) => {
                if (cardData) {
                    const showFace = player.id === manualPlayerId || !areOtherPlayersCardsHidden;
                    const cardToDisplay = showFace ? cardData : null;

                    let isThisCardSelected = false;
                    let isThisCardPlayable = false;

                    if (player.id === manualPlayerId && isP0ManualTurn) {
                        if (p0CardsAreSelectable && selectedCardsForManualAction) {
                            isThisCardSelected = selectedCardsForManualAction.some(selCard => selCard.key === cardData.key);
                        }
                        if (p0CardsArePlayableNow) {
                            isThisCardPlayable = validPlaysForP0.some(vp => vp.key === cardData.key);
                        }
                    }

                    const cardEl = createCardElement(cardToDisplay, p0CardsAreSelectable, isThisCardSelected, isThisCardPlayable);

                    // Add click listeners for P0 manual actions
                    if (player.id === manualPlayerId && isP0ManualTurn) {
                        if (p0CardsAreSelectable) {
                            cardEl.addEventListener('click', () => handleManualCardSelectionForDiscardExchange(cardData));
                        } else if (p0CardsArePlayableNow && isThisCardPlayable) {
                            cardEl.addEventListener('click', () => handleManualCardPlay(cardData));
                        }
                        // If not selectable or playable now, no click listener is added for card action
                    }
                    
                    // Simple overlapping display for fanning - can be improved
                    if (cardCount > fanThreshold) {
                        const minVisiblePartOfCard = cardWidth * 0.25;
                        let cardSpacing = (handContainerWidth - cardWidth) / (cardCount - 1);
                        cardSpacing = Math.max(cardSpacing, minVisiblePartOfCard);
                        cardEl.style.position = 'absolute';
                        cardEl.style.bottom = '0px';
                        cardEl.style.left = `${i * cardSpacing}px`;
                        cardEl.style.zIndex = i;
                    }
                    handDiv.appendChild(cardEl);

                } else {
                    console.warn(`Player ${player.name} has an invalid card in hand.`);
                }
            });
        }
        playerArea.appendChild(handDiv);
    });

    // --- Render Trump & Talon ---
    // ... (trump & talon rendering, unchanged from your previous version) ...
    const trumpCardDisplayEl = document.getElementById('trump-card-display');
    const talonDisplayEl = document.getElementById('talon-display');

    if (trumpCardDisplayEl && talonDisplayEl) {
        trumpCardDisplayEl.innerHTML = '';
        if (gameState.trumpCard && gameState.trumpSuit) {
            const cardEl = createCardElement(gameState.trumpCard);
            trumpCardDisplayEl.appendChild(cardEl);
        } else {
            const cardPlaceholder = document.createElement('div');
            cardPlaceholder.classList.add('card-image-placeholder');
            trumpCardDisplayEl.appendChild(cardPlaceholder);
        }
        const suitLabel = document.createElement('div');
        suitLabel.classList.add('trump-suit-label');
        suitLabel.textContent = 'Trumpf';
        trumpCardDisplayEl.appendChild(suitLabel);

        talonDisplayEl.innerHTML = '';
        const talonCardBackImg = createCardElement(null);
        talonDisplayEl.appendChild(talonCardBackImg);
        const talonCountLabel = document.createElement('div');
        talonCountLabel.classList.add('talon-count-label');

        let talonCountToShow = 0;
        if (gameState.phase === GAME_PHASE.SETUP ||
            (gameState.phase === GAME_PHASE.ROUND_END && gameState.deck && !gameState.deck.isEmpty()) ||
            gameState.phase === GAME_PHASE.ANTE) {
            talonCountToShow = gameState.deck ? gameState.deck.cards.length : 33;
        } else if (gameState.phase === GAME_PHASE.DEALING) {
            talonCountToShow = gameState.deck ? gameState.deck.remaining : 0;
        } else {
            talonCountToShow = gameState.talon ? gameState.talon.length : 0;
        }
        talonCountLabel.textContent = `Talon: ${talonCountToShow}`;
        talonDisplayEl.appendChild(talonCountLabel);

    } else {
        console.warn("Could not find #trump-card-display or #talon-display for game info.");
    }

    // --- Render Trick Area ---
    // ... (trick area rendering, unchanged) ...
    const trickArea = document.getElementById('trick-area');
    trickArea.innerHTML = '';
    (gameState.currentTrick || []).forEach((play) => {
        if (play && play.card && play.player) {
            const cardContainer = document.createElement('div');
            cardContainer.classList.add('trick-card-container');
            const cardEl = createCardElement(play.card);
            cardContainer.appendChild(cardEl);
            const playerIndicator = document.createElement('span');
            playerIndicator.classList.add('trick-card-player');
            playerIndicator.textContent = `P${play.player.id}`;
            cardContainer.appendChild(playerIndicator);
            trickArea.appendChild(cardContainer);
        } else {
             console.warn("Invalid play object, card, or player found in currentTrick.");
        }
    });


    // --- Render Turn Highlight ---
    // ... (turn highlight rendering, largely unchanged, but ensure it doesn't show if P0 is making manual choice) ...
    document.querySelectorAll('.player-area.turn-highlight').forEach(el => el.classList.remove('turn-highlight'));
    if (gameState.turnPlayerIndex !== -1 && gameState.players[gameState.turnPlayerIndex] &&
        !gameState.isAnimating &&
        gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SETUP &&
        gameState.phase !== GAME_PHASE.SCORING && gameState.phase !== GAME_PHASE.ALL_WEITER_PENALTY &&
        gameState.phase !== GAME_PHASE.RESOLVE_ODER && gameState.phase !== GAME_PHASE.TRICK_END &&
        !gameState.isWaitingForBidInput && !gameState.isWaitingForManualPlay &&
        !gameState.isWaitingForManualDiscardSelection && !gameState.isWaitingForManualExchangeChoice &&
        !gameState.isWaitingForManualExchangeCardSelection)
    {
        const turnPlayerArea = document.getElementById(`player-area-${gameState.turnPlayerIndex}`);
        if (turnPlayerArea) turnPlayerArea.classList.add('turn-highlight');
    } else if (isP0ManualTurn && (gameState.isWaitingForBidInput || gameState.isWaitingForManualPlay || gameState.isWaitingForManualDiscardSelection || gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection)) {
        // Highlight P0 specifically when waiting for their manual input
        const turnPlayerArea = document.getElementById(`player-area-${manualPlayerId}`);
        if (turnPlayerArea) turnPlayerArea.classList.add('turn-highlight');
    }


    // --- Render Manual Action Buttons ---
    if (isP0ManualTurn) {
        if (gameState.isWaitingForBidInput && gameState.pendingValidBids.length > 0) {
            gameState.pendingValidBids.forEach(bidOption => {
                const button = document.createElement('button');
                button.textContent = bidOption;
                button.classList.add('bid-button');
                button.addEventListener('click', () => handleUserBid(bidOption));
                bidContainer.appendChild(button);
            });
        } else if (gameState.isWaitingForManualDiscardSelection) {
            const button = document.createElement('button');
            button.textContent = 'Confirm Discard';
            button.classList.add('confirm-action-button');
            // Disable if wrong number of cards selected
            button.disabled = !selectedCardsForManualAction || selectedCardsForManualAction.length !== gameState.numCardsToDiscardManually;
            button.addEventListener('click', handleConfirmManualDiscard);
            manualActionConfirmContainer.appendChild(button);
        } else if (gameState.isWaitingForManualExchangeChoice) {
            const playerP0 = gameState.players[manualPlayerId];
            const validExchangeOpts = GameRules.getValidExchangeOptions(playerP0, gameState.trumpSuit);

            const createExchangeButton = (text, type, isSpecial = false) => {
                const button = document.createElement('button');
                button.textContent = text;
                button.classList.add('exchange-type-button');
                button.dataset.exchangeType = type; // Store type for handler
                if (isSpecial) {
                    button.disabled = !validExchangeOpts.some(opt => opt.type === type);
                }
                button.addEventListener('click', () => handleManualExchangeTypeSelection(type));
                bidContainer.appendChild(button); // Using bidContainer for exchange types
            };

            createExchangeButton('Standard Exchange (Discard)', EXCHANGE_TYPE.STANDARD);
            if (validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.SAU)) {
                 createExchangeButton('4 auf die Sau', EXCHANGE_TYPE.SAU, true);
            }
            if (validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.TRUMPF_PACKERL)) {
                 createExchangeButton('Trumpf-Packerl', EXCHANGE_TYPE.TRUMPF_PACKERL, true);
            }
            if (validExchangeOpts.some(opt => opt.type === EXCHANGE_TYPE.NORMAL_PACKERL)) {
                createExchangeButton('Normales-Packerl', EXCHANGE_TYPE.NORMAL_PACKERL, true);
            }

        } else if (gameState.isWaitingForManualExchangeCardSelection) { // For standard exchange card selection
            const button = document.createElement('button');
            button.textContent = 'Confirm Standard Exchange';
            button.classList.add('confirm-action-button');
             // Standard exchange allows discarding 0 to 4 cards (unless rules dictate otherwise, here we assume up to 4)
            const cardsSelectedCount = selectedCardsForManualAction ? selectedCardsForManualAction.length : 0;
            button.disabled = cardsSelectedCount < 0 || cardsSelectedCount > 4; // Simple check, controller might have more complex validation
            button.addEventListener('click', handleConfirmManualStandardExchange);
            manualActionConfirmContainer.appendChild(button);
        }
        // No explicit "Play Card" button needed as clicking a valid card triggers the play.
    }


    if (nextStepButton) {
        nextStepButton.disabled = gameState.isWaitingForBidInput || gameState.isAnimating ||
                                  (isP0ManualTurn && (gameState.isWaitingForManualPlay ||
                                                      gameState.isWaitingForManualDiscardSelection ||
                                                      gameState.isWaitingForManualExchangeChoice ||
                                                      gameState.isWaitingForManualExchangeCardSelection));
    }
}