import { CommonModule } from '@angular/common';
import { Component, OnDestroy, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { CameraMovement, CameraPathEasing, CameraPathFlow, CameraPathState, DepthBrushSettings, DepthBrushTool, DepthOfFieldFocusMode, DepthOfFieldSettings, EditorHistoryState, GpuDiagnostics, LightingSettings, ParallaxPath, ProjectResponse, SceneLayer, TextOverlay, VideoExportSettings, VideoExportState, VideoLightEffect, ViewerMode } from './models';
import { ViewerComponent } from './viewer/viewer.component';
import { effectiveLayerDepth } from './layer-depth';

@Component({ selector: 'aps-root', standalone: true, imports: [CommonModule, FormsModule, ViewerComponent], templateUrl: './app.component.html', styleUrls: ['./app.component.css', './phase2.css', './depth-editor.css', './lighting.css', './loading.css', './video-export.css'] })
export class AppComponent implements OnDestroy {
  @ViewChild(ViewerComponent) viewer?: ViewerComponent;
  private readonly api = inject(ApiService);
  starless: File | null = null; stars: File | null = null; depthMap: File | null = null; project: ProjectResponse | null = null; busy = false; error = ''; mode: ViewerMode = '3d'; separation = 1; starPresence = 1;
  editorOpen = false;
  brush: DepthBrushSettings = { tool: 'near', size: 80, strength: .25 };
  lighting: LightingSettings = { intensity: .06, relief: 1.2, direction: 135 };
  depthOfField: DepthOfFieldSettings = { enabled: false, focusMode: 'starless', focusLayerId: null, focusDistance: 5, aperture: .002, maxBlur: .006 };
  editorHistory: EditorHistoryState = { canUndo: false, canRedo: false, modified: false };
  soloLayerId: string | null = null; differenceGain = 8; gpu: GpuDiagnostics | null = null;
  cameraMovements: CameraMovement[] = [{ id: 'movement-1', path: {}, duration: 7, easing: 'ease-in-out' }]; activeMovementIndex = 0; cameraRoll = 0; cameraPlayback = false; cameraPathFlow: CameraPathFlow = 'continuous'; transitionMomentum = 0.55;
  readonly maxCameraMovements = 5;
  cameraPathEasingOptions: { value: CameraPathEasing; label: string }[] = [{ value: 'ease-in-out', label: 'Cinematic' }, { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease in' }, { value: 'ease-out', label: 'Ease out' }];
  cameraPathFlowOptions: { value: CameraPathFlow; label: string }[] = [{ value: 'continuous', label: 'Continuous' }, { value: 'per-movement', label: 'Per movement' }];
  videoExport: VideoExportSettings = { width: 1920, height: 1080, fps: 30, lightEffect: 'none' }; videoExporting = false;
  textOverlays: TextOverlay[] = []; activeTextOverlayIndex = 0; readonly maxTextOverlays = 5;
  videoPresets = [{ label: 'Full HD · 16:9', width: 1920, height: 1080 }, { label: 'Square · 1:1', width: 1080, height: 1080 }, { label: 'Portrait · 9:16', width: 1080, height: 1920 }, { label: 'Cinema · 21:9', width: 2560, height: 1080 }];
  loadingProgress = 0; loadingTitle = ''; loadingDetail = '';
  private loadingTimer?: number;
  brushTools: { value: DepthBrushTool; label: string; hint: string }[] = [
    { value: 'near', label: 'Bring closer', hint: 'Lightens the active depth map' },
    { value: 'far', label: 'Push farther', hint: 'Darkens the active depth map' },
    { value: 'smooth', label: 'Smooth', hint: 'Blends abrupt depth transitions' },
    { value: 'protect', label: 'Protect', hint: 'Reduces warp in fragile details' },
  ];
  starSettings = { layerCount: 3, distribution: 'balanced', sensitivity: 3, backgroundMode: 'auto', warpStrength: 0.02, depthSmoothing: 18, absorptionStrength: 0.65, invertDepth: false, fineWarpRatio: 0.25, confidenceAmount: 0.7 };
  private readonly preferencesKey = 'astro-parallax.preferences.v1';
  constructor() { this.restorePreferences(); this.cameraMovements = this.cameraMovements.slice(0, this.maxCameraMovements); }
  ngOnDestroy(): void { this.stopLoadingProgress(); }
  modes: {value: ViewerMode; label: string}[] = [{value:'3d',label:'3D view'},{value:'original',label:'Original'},{value:'reconstructed',label:'Reconstructed'},{value:'difference',label:'Difference'},{value:'depth',label:'Depth map'},{value:'confidence',label:'Stability'}];
  get comparisonUrl(): string | null { if (!this.project || this.mode === '3d') return null; const nebula = this.group('nebula')[0]; if (this.mode === 'depth') return (nebula?.invert_depth ? nebula.inverted_depth_texture_url : nebula?.depth_texture_url) ?? null; if (this.mode === 'confidence') return nebula?.confidence_texture_url ?? null; return this.mode === 'original' ? this.project.comparison.originalUrl : this.mode === 'reconstructed' ? this.project.comparison.reconstructedUrl : this.project.comparison.differenceUrl; }
  get activeMovement(): CameraMovement { return this.cameraMovements[this.activeMovementIndex] ?? this.cameraMovements[0]; }
  get cameraPath(): CameraPathState { return this.activeMovement.path; }
  get cameraPathDuration(): number { return this.activeMovement.duration; }
  get cameraPathEasing(): CameraPathEasing { return this.activeMovement.easing; }
  get canPlaySequence(): boolean { return this.cameraMovements.length > 0 && this.cameraMovements.every(movement => !!movement.path.start && !!movement.path.end); }
  get canLinkActiveMovement(): boolean { return this.activeMovementIndex > 0 && !!this.cameraMovements[this.activeMovementIndex - 1]?.path.end; }
  get activeTextOverlay(): TextOverlay | undefined { return this.textOverlays[this.activeTextOverlayIndex]; }
  get cameraSequenceDuration(): number { return this.cameraMovements.reduce((total, movement) => total + Math.max(5, Math.min(20, movement.duration)), 0); }
  get highRealtimeExportLoad(): boolean { return this.depthOfField.enabled && this.videoExport.width * this.videoExport.height * this.videoExport.fps >= 1920 * 1080 * 30; }
  choose(event: Event, role: 'starless' | 'stars' | 'depthMap'): void { const file = (event.target as HTMLInputElement).files?.[0] ?? null; this[role] = file; this.error = ''; }
  generate(): void { if (!this.starless || !this.stars || this.busy) return; this.savePreferences(); this.busy = true; this.error = ''; this.startLoadingProgress(); this.api.createProject(this.starless, this.stars, this.depthMap, this.starSettings).subscribe({ next: project => { this.stopLoadingProgress(); this.setLoadingProgress(100); window.setTimeout(() => { const previousProjectId = this.project?.projectId; this.applyLayerPreferences(project); this.project = project; this.mode = '3d'; this.soloLayerId = null; this.busy = false; if (previousProjectId && previousProjectId !== project.projectId) this.api.deleteProject(previousProjectId); }, 250); }, error: (error: Error) => { this.stopLoadingProgress(); this.busy = false; this.error = error.message; } }); }
  private startLoadingProgress(): void { this.stopLoadingProgress(); this.setLoadingProgress(4); this.loadingTimer = window.setInterval(() => { const increment = this.loadingProgress < 28 ? 2.2 : this.loadingProgress < 56 ? 1.1 : this.loadingProgress < 78 ? .55 : .18; this.setLoadingProgress(Math.min(94, this.loadingProgress + increment)); }, 220); }
  private stopLoadingProgress(): void { if (this.loadingTimer !== undefined) { window.clearInterval(this.loadingTimer); this.loadingTimer = undefined; } }
  private setLoadingProgress(progress: number): void { this.loadingProgress = progress; const stages = [
    { at: 0, title: 'Reading source images', detail: 'Uploading and validating dimensions and color data…' },
    { at: 18, title: this.depthMap ? 'Loading custom depth map' : 'Building nebula depth', detail: this.depthMap ? 'Validating dimensions and preserving grayscale depth values…' : 'Analyzing emission, absorption, and broad structures…' },
    { at: 40, title: 'Detecting stellar profiles', detail: 'Locating and measuring bright stellar regions…' },
    { at: 62, title: 'Assigning depth layers', detail: 'Distributing stars and preparing the 3D scene…' },
    { at: 78, title: 'Rendering previews', detail: 'Encoding textures and optimized GPU assets…' },
    { at: 90, title: 'Finishing scene', detail: 'Completing assets, metrics, and final validation…' },
    { at: 100, title: 'Scene ready', detail: 'Opening the interactive 3D viewer…' },
  ]; const stage = [...stages].reverse().find(candidate => progress >= candidate.at)!; this.loadingTitle = stage.title; this.loadingDetail = stage.detail; }
  updateLayer(layer: SceneLayer): void { this.project = this.project ? {...this.project, scene: {...this.project.scene, layers: [...this.project.scene.layers]}} : null; this.savePreferences(); }
  resetLayer(layer: SceneLayer): void { const stars = this.group('stars'); const starIndex = stars.findIndex(candidate => candidate.id === layer.id); const initialDepth = layer.type === 'nebula' ? -.35 : -.15 + starIndex * (.6 / Math.max(1, stars.length - 1)); Object.assign(layer, { visible: true, opacity: 1, depth: initialDepth, transform: { position: {x:0,y:0,z:0}, scale: {x:1,y:1,z:1} } }); this.updateLayer(layer); }
  group(type: 'nebula'|'stars'): SceneLayer[] { return this.project?.scene.layers.filter(layer => layer.type === type) ?? []; }
  effectiveDepth(layer: SceneLayer): number { const anchor = this.group('nebula')[0]; return effectiveLayerDepth(layer, anchor?.depth ?? 0, anchor?.transform.position.z ?? 0, this.separation); }
  updateWarp(strength: number): void { this.starSettings.warpStrength = strength; const nebula = this.group('nebula')[0]; if (nebula) { nebula.warp_strength = strength; this.updateLayer(nebula); } else this.savePreferences(); }
  toggleDepth(inverted: boolean): void { this.starSettings.invertDepth = inverted; const nebula = this.group('nebula')[0]; if (nebula) { nebula.invert_depth = inverted; this.updateLayer(nebula); } else this.savePreferences(); }
  updateNebulaParameter(parameter: 'fine_warp_ratio' | 'confidence_amount', value: number): void { if (parameter === 'fine_warp_ratio') this.starSettings.fineWarpRatio = value; else this.starSettings.confidenceAmount = value; const nebula = this.group('nebula')[0]; if (nebula) { nebula[parameter] = value; this.updateLayer(nebula); } else this.savePreferences(); }
  setEditor(open: boolean): void { this.editorOpen = open; if (open) { this.mode = '3d'; this.viewer?.resetCamera(); } }
  setBrushTool(tool: DepthBrushTool): void { this.brush = { ...this.brush, tool }; this.savePreferences(); }
  updateBrush(parameter: 'size' | 'strength', value: number): void { this.brush = { ...this.brush, [parameter]: value }; this.savePreferences(); }
  updateLighting(parameter: keyof LightingSettings, value: number): void { this.lighting = { ...this.lighting, [parameter]: value }; this.savePreferences(); }
  updateDepthOfField(parameter: 'enabled' | 'focusDistance' | 'aperture' | 'maxBlur', value: number | boolean): void {
    const limits: Record<'focusDistance' | 'aperture' | 'maxBlur', [number, number]> = { focusDistance: [.1, 30], aperture: [0, .01], maxBlur: [0, .02] };
    if (parameter === 'enabled') this.depthOfField = { ...this.depthOfField, enabled: !!value };
    else { const [minimum, maximum] = limits[parameter]; this.depthOfField = { ...this.depthOfField, [parameter]: Math.max(minimum, Math.min(maximum, Number(value) || 0)) }; if (parameter === 'focusDistance') this.viewer?.releaseKeyframeFocus(); }
    this.savePreferences();
  }
  updateDepthOfFieldMode(focusMode: DepthOfFieldFocusMode): void { const focusLayerId = focusMode === 'layer' && !this.depthOfField.focusLayerId ? (this.project?.scene.layers[0]?.id ?? null) : this.depthOfField.focusLayerId; this.depthOfField = { ...this.depthOfField, focusMode, focusLayerId }; this.viewer?.releaseKeyframeFocus(); this.savePreferences(); }
  updateDepthOfFieldLayer(focusLayerId: string): void { this.depthOfField = { ...this.depthOfField, focusLayerId }; this.viewer?.releaseKeyframeFocus(); this.savePreferences(); }
  toggleSolo(layer: SceneLayer): void { this.soloLayerId = this.soloLayerId === layer.id ? null : layer.id; }
  preview(path: ParallaxPath): void { this.viewer?.startParallaxPreview(path); }
  updatePreference(parameter: 'separation' | 'starPresence' | 'differenceGain', value: number): void { this[parameter] = value; this.savePreferences(); }
  updateCameraPath(path: CameraPathState): void { this.replaceActiveMovement({ path }); }
  updateCameraSequence(movements: CameraMovement[]): void { if (!movements.length) return; this.cameraMovements = movements.slice(0, this.maxCameraMovements); this.activeMovementIndex = 0; const start = this.cameraMovements[0].path.start; this.cameraRoll = start?.roll ?? 0; if (start) this.viewer?.goToPose(start); this.savePreferences(); }
  updateCameraRoll(value: number): void { this.cameraRoll = Math.max(-180, Math.min(180, Number(value) || 0)); this.savePreferences(); }
  updatePathDuration(value: number): void { this.replaceActiveMovement({ duration: Math.max(5, Math.min(20, Number(value) || 7)) }); }
  updatePathEasing(value: CameraPathEasing): void { this.replaceActiveMovement({ easing: value }); }
  updatePathFlow(value: CameraPathFlow): void { this.cameraPathFlow = value; this.savePreferences(); }
  updateTransitionMomentum(value: number): void { this.transitionMomentum = Math.max(0, Math.min(.9, Number(value) || 0)); this.savePreferences(); }
  selectMovement(index: number): void { if (!this.cameraMovements[index]) return; this.activeMovementIndex = index; const pose = this.cameraMovements[index].path.start ?? this.cameraMovements[index].path.end; if (pose) { this.cameraRoll = pose.roll ?? 0; if (pose.focusDistance !== undefined) this.depthOfField = { ...this.depthOfField, focusDistance: pose.focusDistance }; this.viewer?.goToPose(pose); } }
  addMovement(): void { if (this.cameraMovements.length >= this.maxCameraMovements) return; const previous = this.cameraMovements.at(-1); const start = previous?.path.end ? { ...previous.path.end, position: [...previous.path.end.position] as [number, number, number], target: [...previous.path.end.target] as [number, number, number] } : undefined; this.cameraMovements = [...this.cameraMovements, { id: `movement-${Date.now()}`, path: { start }, duration: previous?.duration ?? 7, easing: previous?.easing ?? 'ease-in-out' }]; this.activeMovementIndex = this.cameraMovements.length - 1; if (start) { this.cameraRoll = start.roll ?? 0; this.viewer?.goToPose(start); } this.savePreferences(); }
  linkActiveMovementToPrevious(): void { const previousEnd = this.cameraMovements[this.activeMovementIndex - 1]?.path.end; if (!previousEnd) return; const start = { ...previousEnd, position: [...previousEnd.position] as [number, number, number], target: [...previousEnd.target] as [number, number, number] }; this.cameraRoll = start.roll ?? 0; this.replaceActiveMovement({ path: { ...this.cameraPath, start } }); this.viewer?.goToPose(start); }
  removeActiveMovement(): void { if (this.cameraMovements.length === 1) return; this.cameraMovements = this.cameraMovements.filter((_, index) => index !== this.activeMovementIndex); this.activeMovementIndex = Math.min(this.activeMovementIndex, this.cameraMovements.length - 1); this.savePreferences(); }
  handlePlaybackState(playing: boolean): void { this.cameraPlayback = playing; }
  private replaceActiveMovement(changes: Partial<CameraMovement>): void { this.cameraMovements = this.cameraMovements.map((movement, index) => index === this.activeMovementIndex ? { ...movement, ...changes } : movement); this.savePreferences(); }
  applyVideoPreset(index: number): void { const preset = this.videoPresets[index]; if (!preset) return; this.videoExport = { ...this.videoExport, width: preset.width, height: preset.height }; this.savePreferences(); }
  updateVideoExport(parameter: Exclude<keyof VideoExportSettings, 'lightEffect'>, value: number): void { const limits = parameter === 'fps' ? [24, 60] : [240, 3840]; const clamped = Math.max(limits[0], Math.min(limits[1], value)); const normalized = parameter === 'fps' ? Math.round(clamped) : Math.round(clamped / 2) * 2; this.videoExport = { ...this.videoExport, [parameter]: normalized }; this.savePreferences(); }
  updateVideoLightEffect(effect: VideoLightEffect): void { this.videoExport = { ...this.videoExport, lightEffect: effect }; this.savePreferences(); }
  addTextOverlay(): void { if (this.textOverlays.length >= this.maxTextOverlays) return; const previous = this.textOverlays.at(-1); const overlay: TextOverlay = previous ? { ...previous, id: `text-${Date.now()}-${this.textOverlays.length + 1}`, text: 'Caption' } : { id: `text-${Date.now()}-1`, text: 'Caption', enabled: true, start: 0, duration: Math.min(5, this.cameraSequenceDuration), fadeIn: .8, fadeOut: .8, x: .5, y: .12, fontFamily: 'Cabin', fontSize: 3.2, fontWeight: 400, letterSpacing: -.015, lineHeight: 1.2, color: '#ffffff', opacity: 1, alignment: 'center', shadow: true, background: true, motion: false }; this.textOverlays = [...this.textOverlays, overlay]; this.activeTextOverlayIndex = this.textOverlays.length - 1; this.savePreferences(); }
  updateTextOverlay(changes: Partial<TextOverlay>): void { if (!this.activeTextOverlay) return; this.textOverlays = this.textOverlays.map((overlay, index) => index === this.activeTextOverlayIndex ? { ...overlay, ...changes } : overlay); this.savePreferences(); }
  updateTextOverlayPosition(change: { id: string; x: number; y: number }): void { const overlay = this.textOverlays.find(item => item.id === change.id); if (!overlay) return; overlay.x = change.x; overlay.y = change.y; this.savePreferences(); }
  removeTextOverlay(): void { if (!this.activeTextOverlay) return; this.textOverlays = this.textOverlays.filter((_, index) => index !== this.activeTextOverlayIndex); this.activeTextOverlayIndex = Math.max(0, Math.min(this.activeTextOverlayIndex, this.textOverlays.length - 1)); this.savePreferences(); }
  handleVideoExportState(state: VideoExportState): void { this.videoExporting = state.exporting; if (state.error) this.error = state.error; }
  savePreferences(): void { try { const previous = JSON.parse(localStorage.getItem(this.preferencesKey) ?? '{}'); const layers = this.project ? Object.fromEntries(this.project.scene.layers.map(layer => [layer.id, { visible: layer.visible, opacity: layer.opacity, depth: layer.depth, transform: layer.transform }])) : (previous.layers ?? {}); localStorage.setItem(this.preferencesKey, JSON.stringify({ starSettings: this.starSettings, separation: this.separation, starPresence: this.starPresence, differenceGain: this.differenceGain, brush: this.brush, lighting: this.lighting, depthOfField: this.depthOfField, cameraMovements: this.cameraMovements, cameraPathFlow: this.cameraPathFlow, transitionMomentum: this.transitionMomentum, cameraRoll: this.cameraRoll, videoExport: this.videoExport, textOverlays: this.textOverlays, layers })); } catch { /* localStorage can be unavailable in restricted contexts. */ } }
  private restorePreferences(): void { try { const raw = localStorage.getItem(this.preferencesKey); if (!raw) return; const saved = JSON.parse(raw); if (saved.starSettings) Object.assign(this.starSettings, saved.starSettings); if (typeof saved.separation === 'number') this.separation = saved.separation; if (typeof saved.starPresence === 'number') this.starPresence = Math.max(.5, Math.min(2.5, saved.starPresence)); if (typeof saved.differenceGain === 'number') this.differenceGain = saved.differenceGain; if (saved.brush) this.brush = { ...this.brush, ...saved.brush }; if (saved.lighting) this.lighting = { ...this.lighting, ...saved.lighting }; if (saved.depthOfField) this.depthOfField = { ...this.depthOfField, ...saved.depthOfField }; if (Array.isArray(saved.cameraMovements) && saved.cameraMovements.length) this.cameraMovements = saved.cameraMovements; else if (saved.cameraPath) this.cameraMovements = [{ id: 'movement-1', path: saved.cameraPath, duration: Math.max(5, Math.min(20, saved.cameraPathDuration ?? (saved.cameraPathSpeed ? 7 / saved.cameraPathSpeed : 7))), easing: this.cameraPathEasingOptions.some(option => option.value === saved.cameraPathEasing) ? saved.cameraPathEasing : 'ease-in-out' }]; if (this.cameraPathFlowOptions.some(option => option.value === saved.cameraPathFlow)) this.cameraPathFlow = saved.cameraPathFlow; if (typeof saved.transitionMomentum === 'number') this.transitionMomentum = Math.max(0, Math.min(.9, saved.transitionMomentum)); if (typeof saved.cameraRoll === 'number') this.cameraRoll = Math.max(-180, Math.min(180, saved.cameraRoll)); if (saved.videoExport) this.videoExport = { ...this.videoExport, ...saved.videoExport }; if (Array.isArray(saved.textOverlays)) this.textOverlays = saved.textOverlays.slice(0, this.maxTextOverlays); } catch { /* Ignore malformed or inaccessible storage. */ } }
  private applyLayerPreferences(project: ProjectResponse): void { try { const saved = JSON.parse(localStorage.getItem(this.preferencesKey) ?? '{}').layers ?? {}; for (const layer of project.scene.layers) { const attributes = saved[layer.id]; if (attributes) Object.assign(layer, attributes, { transform: { ...layer.transform, ...attributes.transform, position: { ...layer.transform.position, ...attributes.transform?.position }, scale: { ...layer.transform.scale, ...attributes.transform?.scale } } }); } } catch { /* Keep generated defaults when stored attributes are invalid. */ } }
  trackLayer(_: number, layer: SceneLayer): string { return layer.id; }
}
