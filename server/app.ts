import type { Hono } from 'hono';
import { onRequestPost as canaryProbePost } from '../functions/api/secops-resilience/canary-probe';
import { onRequestPost as killSwitchPost } from '../functions/api/secops-resilience/kill-switch';
import {
  onRequestPost as verifyBomPost,
  type SecOpsEnv
} from '../functions/api/secops-resilience/verify-bom';
import type { KVNamespace } from './kvAdapter';
import {
  createBaseLabApp,
  verifyRouterSecret,
  type BaseCloudRunEnv
} from './runtime';

export { verifyRouterSecret };

export interface CloudRunEnv extends BaseCloudRunEnv, SecOpsEnv {}

export function createCloudRunApp(options?: {
  env?: CloudRunEnv;
  kv?: KVNamespace;
}): Hono {
  return createBaseLabApp<CloudRunEnv>({
    labSlug: 'secops-resilience',
    env: options?.env,
    kv: options?.kv,
    registerRoutes(app, wrap) {
      app.post('/api/secops-resilience/verify-bom', wrap(verifyBomPost));
      app.post('/api/secops-resilience/canary-probe', wrap(canaryProbePost));
      app.post('/api/secops-resilience/kill-switch', wrap(killSwitchPost));
    }
  });
}
