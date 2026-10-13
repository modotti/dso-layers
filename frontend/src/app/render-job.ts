import { CameraMovement, CameraPathFlow, SceneDocument, TextOverlay, VideoExportSettings } from './models';

export type RenderJobStatus = 'queued' | 'preparing' | 'rendering' | 'encoding' | 'completed' | 'cancelled' | 'failed';
export type RenderAssetRole = 'color' | 'depth' | 'inverted-depth' | 'confidence';

export interface RenderJobAsset { id: string; layerId: string; role: RenderAssetRole; uri: string }
export interface RenderJobManifest {
  version: 1;
  jobId: string;
  scene: SceneDocument;
  assets: RenderJobAsset[];
  timeline: { movements: CameraMovement[]; flow: CameraPathFlow; transitionMomentum: number; overlays: TextOverlay[] };
  output: { width: number; height: number; fps: number; quality: 'draft' | 'final'; lightEffect: VideoExportSettings['lightEffect'] };
}

export interface RenderJobEvent {
  jobId: string;
  status: RenderJobStatus;
  renderedFrames: number;
  totalFrames: number;
  message?: string;
  outputUri?: string;
}

const transitions: Record<RenderJobStatus, readonly RenderJobStatus[]> = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['rendering', 'cancelled', 'failed'],
  rendering: ['encoding', 'cancelled', 'failed'],
  encoding: ['completed', 'cancelled', 'failed'],
  completed: [], cancelled: [], failed: [],
};

export function canTransitionRenderJob(from: RenderJobStatus, to: RenderJobStatus): boolean {
  return transitions[from].includes(to);
}

export function createRenderJobManifest(input: {
  jobId: string;
  scene: SceneDocument;
  movements: CameraMovement[];
  flow: CameraPathFlow;
  transitionMomentum: number;
  overlays: TextOverlay[];
  output: RenderJobManifest['output'];
  baseUri: string;
}): RenderJobManifest {
  const assets: RenderJobAsset[] = [];
  const add = (layerId: string, role: RenderAssetRole, uri?: string | null) => {
    if (uri) assets.push({ id: `${layerId}:${role}`, layerId, role, uri: new URL(uri, input.baseUri).href });
  };
  for (const layer of input.scene.layers) {
    add(layer.id, 'color', layer.texture_url);
    add(layer.id, 'depth', layer.depth_texture_url);
    add(layer.id, 'inverted-depth', layer.inverted_depth_texture_url);
    add(layer.id, 'confidence', layer.confidence_texture_url);
  }
  return {
    version: 1,
    jobId: input.jobId,
    scene: structuredClone(input.scene),
    assets,
    timeline: { movements: structuredClone(input.movements), flow: input.flow, transitionMomentum: input.transitionMomentum, overlays: structuredClone(input.overlays) },
    output: { ...input.output },
  };
}
