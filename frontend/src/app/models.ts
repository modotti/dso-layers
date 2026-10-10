export interface Vector3 { x: number; y: number; z: number }
export interface LayerTransform { position: Vector3; scale: Vector3 }
export type LayerType = 'nebula' | 'stars';
export interface SceneLayer { id: string; name: string; type: LayerType; texture_url: string; depth_texture_url?: string | null; warp_strength?: number; invert_depth?: boolean; depth: number; order: number; visible: boolean; opacity: number; transform: LayerTransform }
export interface SceneDocument {
  schemaVersion: 1;
  name: string;
  source: { width: number; height: number; channels: number; bit_depth: number; format: string; transfer: 'srgb' | 'linear' | 'unknown'; embedded_profile: boolean };
  conventions: { coordinates: string; image_origin: 'top-left'; alpha: 'straight'; compositing: string; texture_color_space: 'srgb'; processing_color_space: 'linear-srgb' };
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number; near: number; far: number; max_orbit_degrees: number; min_distance: number; max_distance: number };
  layers: SceneLayer[];
  processing: { phase: 3; algorithm: string; deterministic: boolean; parameters: Record<string, string | number | boolean>; detectedStars: number };
}
export interface ReconstructionMetrics { mae: number; rmse: number; maxError: number; pixelsOverTolerancePercent: number; tolerance: number }
export interface ProjectResponse {
  projectId: string; scene: SceneDocument;
  metrics: { nebula: ReconstructionMetrics | null; stars: ReconstructionMetrics | null; combined: ReconstructionMetrics };
  comparison: { originalUrl: string; reconstructedUrl: string; differenceUrl: string };
  warnings: string[];
}
export type ViewerMode = '3d' | 'original' | 'reconstructed' | 'difference' | 'depth';
