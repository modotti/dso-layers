import { CommonModule } from '@angular/common';
import { Component, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ApiService } from './api.service';
import { CameraPathState, DepthBrushSettings, DepthBrushTool, EditorHistoryState, GpuDiagnostics, ParallaxPath, ProjectResponse, SceneLayer, ViewerMode } from './models';
import { ViewerComponent } from './viewer/viewer.component';

@Component({ selector: 'aps-root', standalone: true, imports: [CommonModule, FormsModule, ViewerComponent], templateUrl: './app.component.html', styleUrls: ['./app.component.css', './phase2.css', './depth-editor.css'] })
export class AppComponent {
  @ViewChild(ViewerComponent) viewer?: ViewerComponent;
  private readonly api = inject(ApiService);
  starless: File | null = null; stars: File | null = null; project: ProjectResponse | null = null; busy = false; error = ''; mode: ViewerMode = '3d'; separation = 1;
  editorOpen = false;
  brush: DepthBrushSettings = { tool: 'near', size: 80, strength: .25 };
  editorHistory: EditorHistoryState = { canUndo: false, canRedo: false, modified: false };
  soloLayerId: string | null = null; differenceGain = 8; gpu: GpuDiagnostics | null = null;
  cameraPath: CameraPathState = {}; cameraPathDuration = 7;
  brushTools: { value: DepthBrushTool; label: string; hint: string }[] = [
    { value: 'near', label: 'Bring closer', hint: 'Lightens the active depth map' },
    { value: 'far', label: 'Push farther', hint: 'Darkens the active depth map' },
    { value: 'smooth', label: 'Smooth', hint: 'Blends abrupt depth transitions' },
    { value: 'protect', label: 'Protect', hint: 'Reduces warp in fragile details' },
  ];
  starSettings = { layerCount: 3, distribution: 'balanced', sensitivity: 3, backgroundMode: 'auto', warpStrength: 0.02, depthSmoothing: 18, absorptionStrength: 0.65, invertDepth: false, fineWarpRatio: 0.25, confidenceAmount: 0.7 };
  private readonly preferencesKey = 'astro-parallax.preferences.v1';
  constructor() { this.restorePreferences(); }
  modes: {value: ViewerMode; label: string}[] = [{value:'3d',label:'3D view'},{value:'original',label:'Original'},{value:'reconstructed',label:'Reconstructed'},{value:'difference',label:'Difference'},{value:'depth',label:'Depth map'},{value:'confidence',label:'Stability'}];
  get comparisonUrl(): string | null { if (!this.project || this.mode === '3d') return null; const nebula = this.group('nebula')[0]; if (this.mode === 'depth') return (nebula?.invert_depth ? nebula.inverted_depth_texture_url : nebula?.depth_texture_url) ?? null; if (this.mode === 'confidence') return nebula?.confidence_texture_url ?? null; return this.mode === 'original' ? this.project.comparison.originalUrl : this.mode === 'reconstructed' ? this.project.comparison.reconstructedUrl : this.project.comparison.differenceUrl; }
  choose(event: Event, role: 'starless' | 'stars'): void { const file = (event.target as HTMLInputElement).files?.[0] ?? null; this[role] = file; this.error = ''; }
  generate(): void { if (!this.starless || !this.stars || this.busy) return; this.savePreferences(); this.busy = true; this.error = ''; this.api.createProject(this.starless, this.stars, this.starSettings).pipe(finalize(() => this.busy = false)).subscribe({ next: project => { const previousProjectId = this.project?.projectId; this.applyLayerPreferences(project); this.project = project; this.mode = '3d'; this.soloLayerId = null; if (previousProjectId && previousProjectId !== project.projectId) this.api.deleteProject(previousProjectId); }, error: (error: Error) => this.error = error.message }); }
  updateLayer(layer: SceneLayer): void { this.project = this.project ? {...this.project, scene: {...this.project.scene, layers: [...this.project.scene.layers]}} : null; this.savePreferences(); }
  resetLayer(layer: SceneLayer): void { const stars = this.group('stars'); const starIndex = stars.findIndex(candidate => candidate.id === layer.id); const initialDepth = layer.type === 'nebula' ? -.35 : -.15 + starIndex * (.6 / Math.max(1, stars.length - 1)); Object.assign(layer, { visible: true, opacity: 1, depth: initialDepth, transform: { position: {x:0,y:0,z:0}, scale: {x:1,y:1,z:1} } }); this.updateLayer(layer); }
  group(type: 'nebula'|'stars'): SceneLayer[] { return this.project?.scene.layers.filter(layer => layer.type === type) ?? []; }
  updateWarp(strength: number): void { this.starSettings.warpStrength = strength; const nebula = this.group('nebula')[0]; if (nebula) { nebula.warp_strength = strength; this.updateLayer(nebula); } else this.savePreferences(); }
  toggleDepth(inverted: boolean): void { this.starSettings.invertDepth = inverted; const nebula = this.group('nebula')[0]; if (nebula) { nebula.invert_depth = inverted; this.updateLayer(nebula); } else this.savePreferences(); }
  updateNebulaParameter(parameter: 'fine_warp_ratio' | 'confidence_amount', value: number): void { if (parameter === 'fine_warp_ratio') this.starSettings.fineWarpRatio = value; else this.starSettings.confidenceAmount = value; const nebula = this.group('nebula')[0]; if (nebula) { nebula[parameter] = value; this.updateLayer(nebula); } else this.savePreferences(); }
  setEditor(open: boolean): void { this.editorOpen = open; if (open) this.mode = '3d'; }
  setBrushTool(tool: DepthBrushTool): void { this.brush = { ...this.brush, tool }; this.savePreferences(); }
  updateBrush(parameter: 'size' | 'strength', value: number): void { this.brush = { ...this.brush, [parameter]: value }; this.savePreferences(); }
  toggleSolo(layer: SceneLayer): void { this.soloLayerId = this.soloLayerId === layer.id ? null : layer.id; }
  preview(path: ParallaxPath): void { this.viewer?.startParallaxPreview(path); }
  updatePreference(parameter: 'separation' | 'differenceGain', value: number): void { this[parameter] = value; this.savePreferences(); }
  updateCameraPath(path: CameraPathState): void { this.cameraPath = path; this.savePreferences(); }
  updatePathDuration(value: number): void { this.cameraPathDuration = value; this.savePreferences(); }
  savePreferences(): void { try { const previous = JSON.parse(localStorage.getItem(this.preferencesKey) ?? '{}'); const layers = this.project ? Object.fromEntries(this.project.scene.layers.map(layer => [layer.id, { visible: layer.visible, opacity: layer.opacity, depth: layer.depth, transform: layer.transform }])) : (previous.layers ?? {}); localStorage.setItem(this.preferencesKey, JSON.stringify({ starSettings: this.starSettings, separation: this.separation, differenceGain: this.differenceGain, brush: this.brush, cameraPath: this.cameraPath, cameraPathDuration: this.cameraPathDuration, layers })); } catch { /* localStorage can be unavailable in restricted contexts. */ } }
  private restorePreferences(): void { try { const raw = localStorage.getItem(this.preferencesKey); if (!raw) return; const saved = JSON.parse(raw); if (saved.starSettings) Object.assign(this.starSettings, saved.starSettings); if (typeof saved.separation === 'number') this.separation = saved.separation; if (typeof saved.differenceGain === 'number') this.differenceGain = saved.differenceGain; if (saved.brush) this.brush = { ...this.brush, ...saved.brush }; if (saved.cameraPath) this.cameraPath = saved.cameraPath; if (typeof saved.cameraPathDuration === 'number') this.cameraPathDuration = saved.cameraPathDuration; } catch { /* Ignore malformed or inaccessible storage. */ } }
  private applyLayerPreferences(project: ProjectResponse): void { try { const saved = JSON.parse(localStorage.getItem(this.preferencesKey) ?? '{}').layers ?? {}; for (const layer of project.scene.layers) { const attributes = saved[layer.id]; if (attributes) Object.assign(layer, attributes, { transform: { ...layer.transform, ...attributes.transform, position: { ...layer.transform.position, ...attributes.transform?.position }, scale: { ...layer.transform.scale, ...attributes.transform?.scale } } }); } } catch { /* Keep generated defaults when stored attributes are invalid. */ } }
  trackLayer(_: number, layer: SceneLayer): string { return layer.id; }
}
