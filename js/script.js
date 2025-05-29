// js/script.js

// Import necessary functions from controller
import {
    initializeGame,
    nextStep,
    setDealerAnte,
    setMuasPenalty,
    updateStrategyParameter,
    setAnimationSpeed // NEW: Import function to set animation speed
} from './controller.js';
import { RANKS } from './constants.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing Simulation.");

    // --- Get DOM Elements ---
    const nextStepButton = document.getElementById('next-step');
    const animationSpeedSlider = document.getElementById('animation-speed-slider'); // NEW
    const animationSpeedValueSpan = document.getElementById('animation-speed-value'); // NEW

    // Einsatz Sliders
    const dealerAnteSlider = document.getElementById('dealer-ante-slider');
    const dealerAnteValueSpan = document.getElementById('dealer-ante-value');
    const muasPenaltySlider = document.getElementById('no-loser-penalty-slider');
    const muasPenaltyValueSpan = document.getElementById('no-loser-penalty-value');

    // --- Strategy Variable Input Elements (IDs are assumed based on typical naming) ---
    // (These remain the same)
    const minCompanionTrumpValueSelect = document.getElementById('min-companion-trump-value-select');
    const soloAceSneakChanceSlider = document.getElementById('solo-ace-sneak-chance-slider');
    const soloAceSneakChanceValue = document.getElementById('solo-ace-sneak-chance-value');
    const minTrumpForOderMitSelect = document.getElementById('min-trump-oder-mit-select');
    const alwaysSneakLastNoBidCheckbox = document.getElementById('always-sneak-last-no-bid-checkbox');
    const minTrumpValuePlaySneakerSelect = document.getElementById('min-trump-value-play-sneaker-select');
    const lowTrumpPlayChanceSlider = document.getElementById('low-trump-play-chance-slider');
    const lowTrumpPlayChanceValue = document.getElementById('low-trump-play-chance-value');
    const minSuitValueOderPlaySelect = document.getElementById('min-suit-value-oder-play-select');
    const playIfLastNoOneJoinedCheckbox = document.getElementById('play-if-last-no-one-joined-checkbox');
    const maxTrumpValueTrumpfPackerlSelect = document.getElementById('max-trump-value-trumpfpackerl-select');
    const considerSauIfPlannedCheckbox = document.getElementById('consider-sau-if-planned-checkbox');


    function setupStrategyControl(inputId, valueDisplayId, category, parameterName, isCheckbox = false, isFloat = false, isSelect = false) {
        const inputElement = document.getElementById(inputId);
        const valueDisplayElement = valueDisplayId ? document.getElementById(valueDisplayId) : null;

        if (!inputElement) {
            console.warn(`Strategy control element not found: #${inputId}`);
            return;
        }

        let initialValue;
        if (isCheckbox) {
            initialValue = inputElement.checked;
        } else if (isSelect) {
            initialValue = inputElement.value;
        } else {
            initialValue = isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10);
        }

        if (valueDisplayElement && !isCheckbox && !isSelect) {
            valueDisplayElement.textContent = isFloat ? initialValue.toFixed(2) : initialValue.toString();
        }
        updateStrategyParameter(category, parameterName, initialValue);

        const eventType = isCheckbox || isSelect ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            let currentValue;
            if (isCheckbox) {
                currentValue = inputElement.checked;
            } else if (isSelect) {
                currentValue = inputElement.value;
            } else {
                currentValue = isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10);
            }

            if (valueDisplayElement && !isCheckbox && !isSelect) {
                valueDisplayElement.textContent = isFloat ? currentValue.toFixed(2) : currentValue.toString();
            }
            updateStrategyParameter(category, parameterName, currentValue);
        });
    }


    // --- Event Listeners ---

    if (nextStepButton) {
        nextStepButton.addEventListener('click', nextStep);
    } else {
        console.error("Next Step button not found!");
    }

    // NEW: Animation Speed Slider Listener
    if (animationSpeedSlider && animationSpeedValueSpan) {
        const initialSpeed = parseFloat(animationSpeedSlider.value);
        animationSpeedValueSpan.textContent = initialSpeed.toFixed(1) + 's';
        setAnimationSpeed(initialSpeed); // Initialize speed in controller
        animationSpeedSlider.addEventListener('input', () => {
            const speed = parseFloat(animationSpeedSlider.value);
            animationSpeedValueSpan.textContent = speed.toFixed(1) + 's';
            setAnimationSpeed(speed);
        });
    } else {
        console.warn("Animation speed slider or value display not found!");
    }


    if (dealerAnteSlider && dealerAnteValueSpan) {
        const initialAnte = parseFloat(dealerAnteSlider.value);
        dealerAnteValueSpan.textContent = initialAnte.toFixed(1);
        setDealerAnte(initialAnte);
        dealerAnteSlider.addEventListener('input', () => {
            const value = parseFloat(dealerAnteSlider.value);
            dealerAnteValueSpan.textContent = value.toFixed(1);
            setDealerAnte(value);
        });
    } else {
        console.warn("Dealer Ante slider or value display not found!");
    }

    if (muasPenaltySlider && muasPenaltyValueSpan) {
        const initialPenalty = parseFloat(muasPenaltySlider.value);
        muasPenaltyValueSpan.textContent = initialPenalty.toFixed(1);
        setMuasPenalty(initialPenalty);
        muasPenaltySlider.addEventListener('input', () => {
            const value = parseFloat(muasPenaltySlider.value);
            muasPenaltyValueSpan.textContent = value.toFixed(1);
            setMuasPenalty(value);
        });
    } else {
        console.warn('"Muas" Penalty slider or value display not found!');
    }

    // --- Setup Strategy Controls ---
    // (These remain the same)
    setupStrategyControl('min-companion-trump-value-select', null, 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true);
    setupStrategyControl('solo-ace-sneak-chance-slider', 'solo-ace-sneak-chance-value', 'bidStage1', 'soloTrumpAceSneakChance', false, true, false);
    setupStrategyControl('min-trump-oder-mit-select', null, 'bidStage1', 'minTrumpForOderMit', false, false, true);
    setupStrategyControl('always-sneak-last-no-bid-checkbox', null, 'bidStage1', 'alwaysSneakIfLastAndNoBid', true, false, false);
    setupStrategyControl('min-trump-value-play-sneaker-select', null, 'bidStage2', 'minTrumpValueToPlayWithSneaker', false, false, true);
    setupStrategyControl('low-trump-play-chance-slider', 'low-trump-play-chance-value', 'bidStage2', 'lowTrumpPlayChanceWithSneaker', false, true, false);
    setupStrategyControl('min-suit-value-oder-play-select', null, 'bidStage2', 'minSuitValueForOderPlay', false, false, true);
    setupStrategyControl('play-if-last-no-one-joined-checkbox', null, 'bidStage2', 'playIfLastAndNoOneJoined', true, false, false);
    setupStrategyControl('max-trump-value-trumpfpackerl-select', null, 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true);
    setupStrategyControl('consider-sau-if-planned-checkbox', null, 'exchange', 'considerSauIfPlanned', true, false, false);


    initializeGame();

    // --- Future Simulation Logic Placeholder ---
    const runSimButton = document.getElementById('run-simulation-button');
    const numGamesInput = document.getElementById('simulation-games-input');
    const resultsOutput = document.getElementById('simulation-results-output');
    const resultsContainer = document.getElementById('simulation-results-container');

    if (runSimButton && numGamesInput && resultsOutput && resultsContainer) {
        runSimButton.addEventListener('click', () => {
            const numGames = parseInt(numGamesInput.value, 10);
            if (isNaN(numGames) || numGames <= 0) {
                resultsOutput.textContent = "Please enter a valid number of games.";
                resultsContainer.style.display = 'block';
                return;
            }
            logMessageToScreen(`Simulation run requested for ${numGames} games.`);
            resultsOutput.textContent = `Running simulation for ${numGames} games... (Controller function not yet implemented)`;
            resultsContainer.style.display = 'block';
        });
    } else {
        console.warn("One or more simulation control/result elements are missing.");
    }

    function logMessageToScreen(message, elementId = 'simulation-results-output') {
        // const el = document.getElementById(elementId);
        // if (el) { /* ... */ }
    }
});