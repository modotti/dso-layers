import { CommonModule } from '@angular/common';
import { Component, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ApiService } from './api.service';
import { ProjectResponse, SceneLayer, ViewerMode } from './models';
import { ViewerComponent } from './viewer/viewer.component';

@Component({ selector: 'aps-root', standalone: true, imports: [CommonModule, FormsModule, ViewerComponent], templateUrl: './app.component.html', styleUrls: ['./app.component.css', './phase2.css'] })
export class AppComponent {
  @ViewChild(ViewerComponent) viewer?: ViewerComponent;
  private readonly api = inject(ApiService);
  starless: File | null = null; stars: File | null = null; project: ProjectResponse | null = null; busy = false; error = ''; mode: ViewerMode = '3d'; separation = 1;
  starSettings = { layerCount: 3, distribution: 'balanced', sensitivity: 3, backgroundMode: 'auto' };
  modes: {value: ViewerMode; label: string}[] = [{value:'3d',label:'3D view'},{value:'original',label:'Original'},{value:'reconstructed',label:'Reconstructed'},{value:'difference',label:'Difference'}];
  get comparisonUrl(): string | null { if (!this.project || this.mode === '3d') return null; return this.mode === 'original' ? this.project.comparison.originalUrl : this.mode === 'reconstructed' ? this.project.comparison.reconstructedUrl : this.project.comparison.differenceUrl; }
  choose(event: Event, role: 'starless' | 'stars'): void { const file = (event.target as HTMLInputElement).files?.[0] ?? null; this[role] = file; this.error = ''; }
  generate(): void { if (!this.starless || !this.stars || this.busy) return; this.busy = true; this.error = ''; this.api.createProject(this.starless, this.stars, this.starSettings).pipe(finalize(() => this.busy = false)).subscribe({ next: project => { this.project = project; this.mode = '3d'; }, error: (error: Error) => this.error = error.message }); }
  updateLayer(layer: SceneLayer): void { this.project = this.project ? {...this.project, scene: {...this.project.scene, layers: [...this.project.scene.layers]}} : null; }
  resetLayer(layer: SceneLayer): void { const stars = this.group('stars'); const starIndex = stars.findIndex(candidate => candidate.id === layer.id); const initialDepth = layer.type === 'nebula' ? -.35 : -.15 + starIndex * (.6 / Math.max(1, stars.length - 1)); Object.assign(layer, { visible: true, opacity: 1, depth: initialDepth, transform: { position: {x:0,y:0,z:0}, scale: {x:1,y:1,z:1} } }); this.updateLayer(layer); }
  group(type: 'nebula'|'stars'): SceneLayer[] { return this.project?.scene.layers.filter(layer => layer.type === type) ?? []; }
  trackLayer(_: number, layer: SceneLayer): string { return layer.id; }
}
