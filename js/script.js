import {
    initializeGame,
    nextStep,
    setDealerAnte,
    setMuasPenalty,
    updateStrategyParameter,
    setAnimationSpeed,
    runBatchSimulation,
    toggleOtherPlayersCardVisibility // NEW IMPORT
} from './controller.js';
import { RANKS } from './constants.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing Simulation.");

    const nextStepButton = document.getElementById('next-step');
    const animationSpeedSlider = document.getElementById('animation-speed-slider');
    const animationSpeedValueSpan = document.getElementById('animation-speed-value');
    const dealerAnteSlider = document.getElementById('dealer-ante-slider');
    const dealerAnteValueSpan = document.getElementById('dealer-ante-value');
    const muasPenaltySlider = document.getElementById('no-loser-penalty-slider');
    const muasPenaltyValueSpan = document.getElementById('no-loser-penalty-value');

    // NEW: Get reference to the hide cards toggle button
    const hideCardsToggleButton = document.getElementById('hide-cards-toggle');

    // Player 1 (P0) Controls (assuming getters are here)
    // ...
    // Other Players Controls (assuming getters are here)
    // ...

    function setupStrategyControl(inputId, valueDisplayId, targetGroup, category, parameterName, isCheckbox = false, isFloat = false, isSelect = false) {
        const inputElement = document.getElementById(inputId);
        const valueDisplayElement = valueDisplayId ? document.getElementById(valueDisplayId) : null;
        if (!inputElement) { console.warn(`Strategy control element not found: #${inputId}`); return; }
        let initialValue = isCheckbox ? inputElement.checked : (isSelect ? inputElement.value : (isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10)));
        if (valueDisplayElement && !isCheckbox && !isSelect) valueDisplayElement.textContent = isFloat ? initialValue.toFixed(2) : initialValue.toString();
        updateStrategyParameter(targetGroup, category, parameterName, initialValue);
        const eventType = isCheckbox || isSelect ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            let currentValue = isCheckbox ? inputElement.checked : (isSelect ? inputElement.value : (isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10)));
            if (valueDisplayElement && !isCheckbox && !isSelect) valueDisplayElement.textContent = isFloat ? currentValue.toFixed(2) : currentValue.toString();
            updateStrategyParameter(targetGroup, category, parameterName, currentValue);
        });
    }

    if (nextStepButton) nextStepButton.addEventListener('click', nextStep);
    else console.error("Next Step button not found!");

    // NEW: Add event listener for the hide cards toggle button
    if (hideCardsToggleButton) {
        hideCardsToggleButton.addEventListener('click', () => {
            toggleOtherPlayersCardVisibility(); // This function in controller.js should handle state and re-render
        });
    } else {
        console.warn("Hide Cards Toggle button not found!");
    }


    if (animationSpeedSlider && animationSpeedValueSpan) { const initialSpeed = parseFloat(animationSpeedSlider.value); animationSpeedValueSpan.textContent = initialSpeed.toFixed(1) + 's'; setAnimationSpeed(initialSpeed); animationSpeedSlider.addEventListener('input', () => { const speed = parseFloat(animationSpeedSlider.value); animationSpeedValueSpan.textContent = speed.toFixed(1) + 's'; setAnimationSpeed(speed); }); } else console.warn("Animation speed slider or value display not found!");
    if (dealerAnteSlider && dealerAnteValueSpan) { const initialAnte = parseFloat(dealerAnteSlider.value); dealerAnteValueSpan.textContent = initialAnte.toFixed(1); setDealerAnte(initialAnte); dealerAnteSlider.addEventListener('input', () => { const value = parseFloat(dealerAnteSlider.value); dealerAnteValueSpan.textContent = value.toFixed(1); setDealerAnte(value); }); } else console.warn("Dealer Ante slider or value display not found!");
    if (muasPenaltySlider && muasPenaltyValueSpan) { const initialPenalty = parseFloat(muasPenaltySlider.value); muasPenaltyValueSpan.textContent = initialPenalty.toFixed(1); setMuasPenalty(initialPenalty); muasPenaltySlider.addEventListener('input', () => { const value = parseFloat(muasPenaltySlider.value); muasPenaltyValueSpan.textContent = value.toFixed(1); setMuasPenalty(value); }); } else console.warn('"Muas" Penalty slider or value display not found!');

    // P0 Strategy Setup (Shortened for brevity, assume they are all here)
    setupStrategyControl('min-companion-trump-value-select-p1', null, 'player1', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true); // ... and all others for P1
    setupStrategyControl('solo-ace-sneak-chance-slider-p1', 'solo-ace-sneak-chance-value-p1', 'player1', 'bidStage1', 'soloTrumpAceSneakChance', false, true, false); setupStrategyControl('min-trump-oder-mit-select-p1', null, 'player1', 'bidStage1', 'minTrumpForOderMit', false, false, true); setupStrategyControl('always-sneak-last-no-bid-checkbox-p1', null, 'player1', 'bidStage1', 'alwaysSneakIfLastAndNoBid', true, false, false); setupStrategyControl('min-trump-value-play-sneaker-select-p1', null, 'player1', 'bidStage2', 'minTrumpValueToPlayWithSneaker', false, false, true); setupStrategyControl('low-trump-play-chance-slider-p1', 'low-trump-play-chance-value-p1', 'player1', 'bidStage2', 'lowTrumpPlayChanceWithSneaker', false, true, false); setupStrategyControl('min-suit-value-oder-play-select-p1', null, 'player1', 'bidStage2', 'minSuitValueForOderPlay', false, false, true); setupStrategyControl('play-if-last-no-one-joined-checkbox-p1', null, 'player1', 'bidStage2', 'playIfLastNoOneJoined', true, false, false); setupStrategyControl('max-trump-value-trumpfpackerl-select-p1', null, 'player1', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true); setupStrategyControl('consider-sau-if-planned-checkbox-p1', null, 'player1', 'exchange', 'considerSauIfPlanned', true, false, false);
    // Others Strategy Setup (Shortened for brevity, assume they are all here)
    setupStrategyControl('min-companion-trump-value-select-others', null, 'otherPlayers', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true); // ... and all others for Others
    setupStrategyControl('solo-ace-sneak-chance-slider-others', 'solo-ace-sneak-chance-value-others', 'otherPlayers', 'bidStage1', 'soloTrumpAceSneakChance', false, true, false); setupStrategyControl('min-trump-oder-mit-select-others', null, 'otherPlayers', 'bidStage1', 'minTrumpForOderMit', false, false, true); setupStrategyControl('always-sneak-last-no-bid-checkbox-others', null, 'otherPlayers', 'bidStage1', 'alwaysSneakIfLastAndNoBid', true, false, false); setupStrategyControl('min-trump-value-play-sneaker-select-others', null, 'otherPlayers', 'bidStage2', 'minTrumpValueToPlayWithSneaker', false, false, true); setupStrategyControl('low-trump-play-chance-slider-others', 'low-trump-play-chance-value-others', 'otherPlayers', 'bidStage2', 'lowTrumpPlayChanceWithSneaker', false, true, false); setupStrategyControl('min-suit-value-oder-play-select-others', null, 'otherPlayers', 'bidStage2', 'minSuitValueForOderPlay', false, false, true); setupStrategyControl('play-if-last-no-one-joined-checkbox-others', null, 'otherPlayers', 'bidStage2', 'playIfLastNoOneJoined', true, false, false); setupStrategyControl('max-trump-value-trumpfpackerl-select-others', null, 'otherPlayers', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true); setupStrategyControl('consider-sau-if-planned-checkbox-others', null, 'otherPlayers', 'exchange', 'considerSauIfPlanned', true, false, false);

    initializeGame();

    const runSimButton = document.getElementById('run-simulation-button');
    const numGamesInput = document.getElementById('simulation-games-input');
    const resultsOutput = document.getElementById('simulation-results-output');
    const resultsContainer = document.getElementById('simulation-results-container');
    const chartContainer = document.getElementById('simulation-chart-container');
    const barChartArea = document.getElementById('bar-chart-area');
    const progressContainer = document.getElementById('simulation-progress-container');
    const progressBarFill = document.getElementById('simulation-progress-bar-fill');
    const progressText = document.getElementById('simulation-progress-text');


    if (runSimButton && numGamesInput && resultsOutput && resultsContainer && chartContainer && barChartArea && progressContainer && progressBarFill && progressText) {
        // Make result containers always visible but clear their content
        resultsContainer.style.display = 'block';
        chartContainer.style.display = 'block';
        resultsOutput.textContent = 'Run a simulation to see results.';
        barChartArea.innerHTML = ''; // Clear previous chart

        runSimButton.addEventListener('click', async () => {
            const numGames = parseInt(numGamesInput.value, 10);
            if (isNaN(numGames) || numGames <= 0) {
                resultsOutput.textContent = "Please enter a valid number of games.";
                barChartArea.innerHTML = '';
                progressContainer.style.display = 'none';
                return;
            }

            runSimButton.disabled = true; runSimButton.textContent = 'Running...';
            resultsOutput.textContent = `Initializing simulation for ${numGames} games...`; // Changed initial message
            barChartArea.innerHTML = ''; // Clear previous chart

            progressContainer.style.display = 'block';
            progressBarFill.style.width = '0%';
            progressText.textContent = '0%';

            const updateProgressUI = (percentage) => {
                progressBarFill.style.width = `${percentage.toFixed(2)}%`;
                progressText.textContent = `${percentage.toFixed(0)}%`;
            };

            try {
                // Small delay to allow the "Initializing" message and progress bar to render
                await new Promise(resolve => setTimeout(resolve, 50));

                const simulationResults = await runBatchSimulation(numGames, updateProgressUI);
                displaySimulationResults(simulationResults);
                displayBarChart(simulationResults);
                if(simulationResults.gamesCompleted === numGames) {
                    progressText.textContent = '100% Done';
                } else {
                    progressText.textContent = `Completed ${simulationResults.gamesCompleted}/${numGames}`;
                }
            } catch (error) {
                console.error("Error during batch simulation:", error);
                resultsOutput.textContent = `Error during simulation: ${error.message}`;
                progressText.textContent = 'Error!';
            } finally {
                runSimButton.disabled = false; runSimButton.textContent = 'Run Simulation';
                // Do not hide progressContainer on completion if you want to see "100% Done"
            }
        });
    } else {
        console.warn("One or more simulation control/result/chart/progress elements are missing.");
    }

    function displaySimulationResults(results) {
        let outputText = `Simulation Complete:\n`;
        outputText += `Games Simulated: ${results.gamesSimulated}\n`;
        outputText += `Games Successfully Completed: ${results.gamesCompleted}\n\n`;
        outputText += `Total Points per Player:\n`;
        results.playerNames.forEach((name, index) => {
            const totalPts = results.totalPoints[index];
            const avgPts = results.gamesCompleted > 0 ? (totalPts / results.gamesCompleted).toFixed(2) : 'N/A';
            outputText += `${name || ('P'+index)}: ${totalPts.toFixed(1)} points (Avg: ${avgPts} per game)\n`;
        });
        resultsOutput.textContent = outputText;
    }
    function displayBarChart(results) {
        barChartArea.innerHTML = '';
        const points = results.totalPoints; const playerNames = results.playerNames;
        let minPoint = 0; let maxPoint = 0; points.forEach(p => { if (p < minPoint) minPoint = p; if (p > maxPoint) maxPoint = p; });
        const dataRange = maxPoint - minPoint; const chartHeight = 200;
        points.forEach((point, index) => {
            const barContainer = document.createElement('div'); barContainer.classList.add('bar-container');
            const barValue = document.createElement('div'); barValue.classList.add('bar-value'); barValue.textContent = point.toFixed(1);
            const bar = document.createElement('div'); bar.classList.add('bar'); bar.classList.add(`bar-p${index}`);
            let barHeightPercentage;
            if (dataRange === 0) barHeightPercentage = point === 0 ? 0 : 50;
            else barHeightPercentage = ( (point - minPoint) / dataRange ) * 100;
            if (point < 0 && minPoint < 0) { // Only color differently if there are actually negative values in the scale
                 bar.style.backgroundColor = '#c0392b'; bar.style.borderColor = '#a93226';
            } else if (point === 0 && minPoint < 0) { // If score is zero on a scale with negatives
                 bar.style.backgroundColor = '#7f8c8d'; bar.style.borderColor = '#707b7c';
            }
            barHeightPercentage = Math.max(0.5, barHeightPercentage); // Min height 0.5% to be visible for small values
            bar.style.height = `${(barHeightPercentage / 100) * chartHeight}px`;
            const barLabel = document.createElement('div'); barLabel.classList.add('bar-label'); barLabel.textContent = playerNames[index] || `P${index}`;
            barContainer.appendChild(barValue); barContainer.appendChild(bar); barContainer.appendChild(barLabel); barChartArea.appendChild(barContainer);
        });
    }
});