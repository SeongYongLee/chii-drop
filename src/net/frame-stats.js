// 로컬 진단용 집계. 경기 상태·전송 주기와 독립적이며 외부로 보내지 않는다.
export function createFrameStats() {
  let start = null, frames = 0, simulation = 0, drawing = 0, samples = 0, waiting = 0, peak = 0;
  let current = { fps: 0, simulation: 0, drawing: 0, peak: 0, waiting: 0 };
  return {
    record(time, sample) {
      start ??= time;
      frames += sample.render ? 1 : 0; samples++;
      simulation += sample.simulation; drawing += sample.drawing;
      peak = Math.max(peak, sample.simulation + sample.drawing); waiting += sample.waiting ? 1 : 0;
      if (time - start < 1000) return false;
      current = { fps: Math.round(frames * 1000 / (time - start)), simulation: simulation / samples,
        drawing: frames ? drawing / frames : 0, peak, waiting };
      start = time; frames = simulation = drawing = samples = waiting = peak = 0;
      return true;
    },
    get current() { return current; },
  };
}
