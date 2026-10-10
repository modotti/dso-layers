import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => { localStorage.clear(); await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient()] }).compileComponents(); });
  it('starts with the import workflow', () => {
    const fixture = TestBed.createComponent(AppComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Build scene');
    expect(fixture.nativeElement.textContent).toContain('Reveal the space inside your image');
  });
  it('restores saved viewer preferences', () => {
    const first = TestBed.createComponent(AppComponent).componentInstance;
    first.updatePreference('separation', 2.2);
    first.updateWarp(0.035);
    first.updateLighting('intensity', .11);
    first.updateCameraRoll(-28);
    first.updatePathDuration(16);
    first.updatePathEasing('ease-out');
    first.updateVideoExport('width', 2560);
    first.updateVideoExport('fps', 60);
    const restored = TestBed.createComponent(AppComponent).componentInstance;
    expect(restored.separation).toBe(2.2);
    expect(restored.starSettings.warpStrength).toBe(0.035);
    expect(restored.lighting.intensity).toBe(.11);
    expect(restored.cameraRoll).toBe(-28);
    expect(restored.cameraPathDuration).toBe(16);
    expect(restored.cameraPathEasing).toBe('ease-out');
    expect(restored.videoExport.width).toBe(2560);
    expect(restored.videoExport.fps).toBe(60);
  });
});
