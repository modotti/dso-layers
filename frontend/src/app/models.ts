export interface Vector3 { x: number; y: number; z: number }
export interface LayerTransform { position: Vector3; scale: Vector3 }
export type LayerType = 'nebula' | 'stars';
export interface SceneLayer { id: string; name: string; type: LayerType; texture_url: string; depth_texture_url?: string | null; inverted_depth_texture_url?: string | null; confidence_texture_url?: string | null; warp_strength?: number; fine_warp_ratio?: number; confidence_amount?: number; invert_depth?: boolean; depth: number; order: number; visible: boolean; opacity: number; transform: LayerTransform }
export interface SceneDocument {
  schemaVersion: 1;
  name: string;
  source: { width: number; height: number; channels: number; bit_depth: number; format: string; transfer: 'srgb' | 'linear' | 'unknown'; embedded_profile: boolean };
  conventions: { coordinates: string; image_origin: 'top-left'; alpha: 'straight'; compositing: string; texture_color_space: 'srgb'; processing_color_space: 'linear-srgb' };
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number; near: number; far: number; max_orbit_degrees: number; min_distance: number; max_distance: number };
  layers: SceneLayer[];
  processing: { phase: 4; algorithm: string; deterministic: boolean; parameters: Record<string, string | number | boolean>; detectedStars: number };
}
export interface ReconstructionMetrics { mae: number; rmse: number; maxError: number; pixelsOverTolerancePercent: number; tolerance: number }
export interface ProjectResponse {
  projectId: string; scene: SceneDocument;
  metrics: { nebula: ReconstructionMetrics | null; stars: ReconstructionMetrics | null; combined: ReconstructionMetrics };
  comparison: { originalUrl: string; reconstructedUrl: string; differenceUrl: string };
  warnings: string[];
}
export type ViewerMode = '3d' | 'original' | 'reconstructed' | 'difference' | 'depth' | 'confidence';
export type DepthBrushTool = 'near' | 'far' | 'smooth' | 'protect';
export interface DepthBrushSettings { tool: DepthBrushTool; size: number; strength: number }
export interface LightingSettings { intensity: number; relief: number; direction: number }
export type DepthOfFieldFocusMode = 'starless' | 'target' | 'layer' | 'manual';
export interface DepthOfFieldSettings { enabled: boolean; focusMode: DepthOfFieldFocusMode; focusLayerId: string | null; focusDistance: number; aperture: number; maxBlur: number }
export interface EditorHistoryState { canUndo: boolean; canRedo: boolean; modified: boolean }
export type ParallaxPath = 'horizontal' | 'vertical' | 'orbit';
export interface GpuDiagnostics { maxTextureSize: number; renderer: string; previewWidth: number; previewHeight: number; sourceTooLarge: boolean }
export interface CameraPathPose { position: [number, number, number]; target: [number, number, number]; roll?: number; focusDistance?: number }
export interface CameraPathState { start?: CameraPathPose; end?: CameraPathPose }
export type CameraPathEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type CameraPathFlow = 'per-movement' | 'continuous';
export interface CameraMovement { id: string; path: CameraPathState; duration: number; easing: CameraPathEasing }
export type VideoLightEffect = 'none' | 'soft-reflections';
export interface VideoExportSettings { width: number; height: number; fps: number; lightEffect: VideoLightEffect }
export interface VideoExportState { exporting: boolean; error?: string }
export type TextOverlayAlignment = 'left' | 'center' | 'right';
export type TextOverlayFont = 'Cabin' | 'Bitter' | 'DM Sans';
export interface TextOverlay {
  id: string; text: string; enabled: boolean; start: number; duration: number; fadeIn: number; fadeOut: number;
  x: number; y: number; fontFamily: TextOverlayFont; fontSize: number; fontWeight: number; letterSpacing: number; lineHeight: number; color: string; opacity: number;
  alignment: TextOverlayAlignment; shadow: boolean; background: boolean; motion: boolean;
}
