import { PLAYER_STATUS, GAME_PHASE, getCardImageFilename, WELI_RANK } from './constants.js';
import { handleUserBid, isSimulationRunning, areOtherPlayersCardsHidden } from './controller.js'; // IMPORT isSimulationRunning & areOtherPlayersCardsHidden

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
    // NEW: Skip animation if simulation is running
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
function createCardElement(card) {
    const imgElement = document.createElement('img');
    imgElement.classList.add('card-image');

    imgElement.src = `img/${getCardImageFilename(card)}`;
    imgElement.alt = card ? card.toString() : "Card Back";

    if (card && card.rank !== WELI_RANK) {
        imgElement.title = `${card.rank} of ${card.suit}`;
    } else if (card && card.rank === WELI_RANK) {
         imgElement.title = 'Weli';
    } else {
         imgElement.title = 'Card Back';
    }

    imgElement.onerror = function() {
        console.error(`Failed to load image: ${this.src}`);
        this.alt = `Error loading ${this.alt}`;
        this.style.border = '2px solid red';
    };
    return imgElement;
}


export function renderGame(gameState) {
    // NEW: Skip rendering if simulation is running
    if (isSimulationRunning) {
        return;
    }

    const logBox = document.getElementById('log-box');
    const nextStepButton = document.getElementById('next-step');

    if (!gameState) {
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
            const talonCardBackImg = createCardElement(null);
            talonDisplayEl.appendChild(talonCardBackImg);
            const talonCountLabel = document.createElement('div');
            talonCountLabel.classList.add('talon-count-label');
            talonCountLabel.textContent = `Talon: 33`;
            talonDisplayEl.appendChild(talonCountLabel);
        }
        return;
    }

    // --- Render Player Hands & Info ---
    gameState.players.forEach((player, index) => {
        const playerArea = document.getElementById(`player-area-${index}`);
        if (!playerArea) return;
        playerArea.innerHTML = '';

        const infoDiv = document.createElement('div');
        infoDiv.classList.add('player-info');
        let dealerIndicator = (player.id === gameState.dealerIndex) ? ' <span class="dealer-indicator">DEALER</span>' : '';
        const playerNameHTML = `<p>${player.name} (P${player.id})${dealerIndicator}</p>`;
        const statusHTML = `<p>Status: ${player.status}</p>`;
        const pointsHTML = `<p>Punkte: ${player.points.toFixed(1)}</p>`;
        let trickDisplay = player.tricksWonThisRound > 0 ? `<span class="tricks-highlight">${player.tricksWonThisRound}</span>` : player.tricksWonThisRound;
        const tricksHTML = `<p>Stiche: ${trickDisplay}</p>`;
        const bidHTML = `<p>Spielzug: ${player.currentBid || ''}</p>`;
        let actionText = player.lastActionLog || '-';
         if (player.id === gameState.turnPlayerIndex && !gameState.isWaitingForBidInput && !gameState.isAnimating) {
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
        } else if (player.id === gameState.turnPlayerIndex && gameState.isWaitingForBidInput) {
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
        const handContainerWidth = 380;

        if (cardCount > 0) {
            if (cardCount <= fanThreshold) {
                hand.forEach(card => {
                    if (card) {
                        // NEW: Check if this player's cards should be hidden
                        const cardToShow = (player.id !== 0 && areOtherPlayersCardsHidden) ? null : card;
                        const cardEl = createCardElement(cardToShow);
                        handDiv.appendChild(cardEl);
                    } else {
                        console.warn(`Player ${player.name} has an invalid card in hand.`);
                    }
                });
            } else {
                const minVisiblePartOfCard = cardWidth * 0.25;
                let cardSpacing;
                if (cardCount > 1) cardSpacing = (handContainerWidth - cardWidth) / (cardCount - 1);
                else cardSpacing = 0;
                cardSpacing = Math.max(cardSpacing, minVisiblePartOfCard);
                hand.forEach((card, i) => {
                    if (card) {
                        // NEW: Check if this player's cards should be hidden
                        const cardToShow = (player.id !== 0 && areOtherPlayersCardsHidden) ? null : card;
                        const cardEl = createCardElement(cardToShow);
                        cardEl.style.position = 'absolute';
                        cardEl.style.bottom = '0px';
                        let leftPosition = i * cardSpacing;
                        cardEl.style.left = `${leftPosition}px`;
                        cardEl.style.zIndex = cardCount - i;
                        handDiv.appendChild(cardEl);
                    } else {
                        console.warn(`Player ${player.name} has an invalid card in hand (fanning).`);
                    }
                });
            }
        }
        playerArea.appendChild(handDiv);
    });

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

    const trickArea = document.getElementById('trick-area');
    trickArea.innerHTML = '';
    (gameState.currentTrick || []).forEach((play, index) => {
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

    document.querySelectorAll('.player-area.turn-highlight').forEach(el => el.classList.remove('turn-highlight'));
    if (gameState.turnPlayerIndex !== -1 && gameState.players[gameState.turnPlayerIndex] &&
        !gameState.isAnimating &&
        gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SETUP &&
        gameState.phase !== GAME_PHASE.SCORING && gameState.phase !== GAME_PHASE.ALL_WEITER_PENALTY &&
        gameState.phase !== GAME_PHASE.RESOLVE_ODER && gameState.phase !== GAME_PHASE.TRICK_END)
    {
        const turnPlayerArea = document.getElementById(`player-area-${gameState.turnPlayerIndex}`);
        if (turnPlayerArea) turnPlayerArea.classList.add('turn-highlight');
    }

    const bidContainer = document.getElementById('bid-options-container');
    bidContainer.innerHTML = '';
    if (gameState.isWaitingForBidInput && gameState.pendingValidBids.length > 0) {
        gameState.pendingValidBids.forEach(bidOption => {
            const button = document.createElement('button');
            button.textContent = bidOption;
            button.classList.add('bid-button');
            button.addEventListener('click', () => handleUserBid(bidOption));
            bidContainer.appendChild(button);
        });
        if (nextStepButton) nextStepButton.disabled = true;
    } else {
        if (nextStepButton) nextStepButton.disabled = gameState.isWaitingForBidInput || gameState.isAnimating;
    }
}