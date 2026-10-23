import { FLOORS, HIDDEN_IDS, SECRET_FINAL, opponentProfile } from '../story/campaign.js';
import { afterCeremony, applyMatchResult, createRecords, createRun, secretUnlocked } from '../story/progress.js';
import { characterOf, sceneLines } from '../story/script.js';

import { createDialogueScene } from './dialogue-scene.js';
import { createGameScene } from './game-scene.js';
import { loadStory, saveStory } from './storage.js';
import { createTowerScene } from './tower-scene.js';

// 스토리 모드의 장면 흐름: 대사 → 탑(상대 선정) → 경기 전 대사 → 경기 → 경기 후 대사 → …
function createStoryFlow(app) {
  const saved = loadStory();
  const story = {
    run: saved?.run ?? null,
    records: { ...createRecords(), ...saved?.records },
  };
  let challenge = false;
  let hostRevealed = false;
  let lastTowerFloor = story.run?.floorIndex ?? 0;
  const suspendedRun = story.run;

  const save = () => saveStory({ run: challenge ? suspendedRun : story.run, records: story.records });

  const showLines = (keys, opponent, next) => {
    let lines = sceneLines(app.storyScript, keys, opponent);
    if (hostRevealed && opponent === SECRET_FINAL && keys.includes(SECRET_FINAL + '.lose') && lines.length) {
      lines = [{ ...lines[0], visual: 'inside', stage: { ...lines[0].stage, hostForm: 'large', phase: 'wait', quiet: true } }, ...lines.slice(1)];
    }
    const guests = keys.includes('secretEnding') || opponent === SECRET_FINAL
      ? [...HIDDEN_IDS, SECRET_FINAL] : story.run?.hiddenMet ?? [];
    app.setScene(createDialogueScene({ lines, script: app.storyScript, opponent, guests, onDone: next,
      musicScene: keys.some((key) => ['ceremony', 'secretEnding', 'done'].includes(key)) ? 'result' : 'story',
      scenery: opponent === SECRET_FINAL ? 'inside' : ['meadow', 'market', 'grove', 'hill', 'summit'][story.run?.floorIndex ?? 0],
    }));
  };

  const toMenu = () => {
    save();
    app.goToSinglePlayer();
  };

  function toTower() {
    if (story.run.stage === 'done') {
      showLines(['done'], null, finishRun);
      return;
    }
    if (story.run.stage === 'ceremony') {
      showLines(['ceremony'], null, () => {
        story.run = afterCeremony(story.run, story.records);
        save();
        if (story.run.stage === 'secretFinal') {
          showLines(['secretFinal.invite'], null, toTower);
        } else {
          showLines(['done'], null, finishRun);
        }
      });
      return;
    }
    if (story.run.stage === 'secretEnding') {
      showLines(['secretEnding'], SECRET_FINAL, finishRun);
      return;
    }
    app.setScene(createTowerScene({
      run: story.run, records: story.records, script: app.storyScript,
      fromFloor: lastTowerFloor,
      onPick: (_, id) => beforeMatch(id), onBack: toMenu,
    }));
    lastTowerFloor = story.run.floorIndex;
  }

  function finishRun() {
    story.run = null;
    toMenu();
  }

  function beforeMatch(opponent) {
    const before = () => showLines([`${opponent}.before`, 'opponent.before'], opponent, () => startMatch(opponent));
    if (story.run.stage === 'hidden') {
      showLines([`${opponent}.appear`, 'hidden.appear'], opponent, before);
    } else if (story.run.stage === 'fixed') {
      showLines([`${opponent}.appear`, 'fixed.appear'], opponent, before);
    } else {
      before();
    }
  }

  function startMatch(opponent) {
    hostRevealed = false;
    const profile = opponentProfile(opponent);
    const playerChar = characterOf(app.storyScript, 'player');
    const opponentChar = characterOf(app.storyScript, opponent);
    app.setScene(
      createGameScene({
        mode: 'story',
        scenery: opponent === SECRET_FINAL ? 'inside' : ['meadow', 'market', 'grove', 'hill', 'summit'][story.run.floorIndex],
        cpuLevel: profile.cpuLevel,
        boss: profile.boss,
        story: { startLevel: profile.startLevel, colors: profile.colors },
        revivedForm: opponent === SECRET_FINAL ? opponentChar.storyForm : null,
        reviveLine: sceneLines(app.storyScript, [`${opponent}.fever`], opponent)[0]?.text,
        onRevive: (onDone) => {
          hostRevealed = true;
          return createDialogueScene({
            lines: sceneLines(app.storyScript, [`${opponent}.fever`], opponent),
            script: app.storyScript, opponent, onDone,
            guests: [...HIDDEN_IDS, SECRET_FINAL], scenery: opponent === SECRET_FINAL ? 'inside' : 'dialogue',
          });
        },
        characters: [
          { id: playerChar.charId, name: playerChar.name },
          { id: opponentChar.charId, name: opponentChar.name },
        ],
        onFinish: (_, result) => afterMatch(opponent, result),
        onQuit: (_, result) => {
          if (result) {
            const next = applyMatchResult(story.run, story.records, { ...result, opponent });
            story.run = next.run;
            story.records = next.records;
          }
          toMenu();
        },
      }),
    );
  }

  function afterMatch(opponent, result) {
    const before = story.run;
    const next = applyMatchResult(story.run, story.records, { ...result, opponent });
    story.run = next.run;
    story.records = next.records;
    save();
    if (!result.won) {
      showLines([`${opponent}.lose`, 'opponent.lose'], opponent, () => startMatch(opponent));
      return;
    }
    const followUp = () => {
      if (story.run.floorIndex !== before.floorIndex && story.run.stage === 'ordinary') {
        showLines([`floor${story.run.floorIndex + 1}.start`, 'floor.start'], null, toTower);
      } else {
        toTower();
      }
    };
    showLines([`${opponent}.win`, 'opponent.win'], opponent, followUp);
  }

  return {
    hasRun: () => story.run !== null,
    hiddenWins: () => HIDDEN_IDS.filter((id) => story.records.hiddenWon.includes(id)).length,
    canChallenge: () => story.records.mainCleared && secretUnlocked(story.records),
    challenge() {
      if (!story.records.mainCleared || !secretUnlocked(story.records)) return;
      challenge = true;
      story.run = { ...createRun(), floorIndex: FLOORS.length, stage: 'secretFinal', hiddenMet: [...HIDDEN_IDS] };
      showLines(['secretFinal.invite'], null, toTower);
    },
    start() {
      story.run = createRun();
      lastTowerFloor = 0;
      save();
      showLines(['opening'], null, toTower);
    },
    resume() {
      toTower();
    },
  };
}

export { createStoryFlow };
