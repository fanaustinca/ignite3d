import { useCadStore } from '../store/useCadStore';
import { ensureAllSnaps } from '../services/visuals';
import { buildExampleRobot, exampleSkus } from './example';
import { viewportBus } from '../viewport/Viewport';

/** Load the example drivetrain (fetches the real parts' snap points first). */
export async function loadExample() {
  const st = useCadStore.getState();
  const S = exampleSkus(st.catalog);
  await ensureAllSnaps(Object.values(S).concat(['2812-0004-0007']));
  try {
    const robot = buildExampleRobot(useCadStore.getState().catalog);
    useCadStore.getState().setInstances(robot);
    useCadStore.getState().toast(`Loaded the example drivetrain (${robot.length} parts) — every screw was placed by Smart Fasten.`, 'ok');
    setTimeout(() => viewportBus.fit(), 60);
  } catch (e) {
    useCadStore.getState().toast(`Could not build the example: ${(e as Error).message}`, 'error');
  }
}
