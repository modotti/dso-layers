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
  it('chains a new camera movement from the previous endpoint', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const end = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], roll: 24 };
    component.updateCameraPath({ start: { position: [0, 0, 5], target: [0, 0, 0], roll: 0 }, end });
    component.updatePathDuration(12);
    component.updatePathEasing('ease-out');
    component.addMovement();
    expect(component.cameraMovements.length).toBe(2);
    expect(component.cameraPath.start).toEqual(end);
    expect(component.cameraPath.end).toBeUndefined();
    expect(component.cameraPathDuration).toBe(12);
    expect(component.cameraPathEasing).toBe('ease-out');
  });
  it('limits the camera timeline to five movements', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    for (let index = 0; index < 8; index++) component.addMovement();
    expect(component.cameraMovements.length).toBe(5);
  });
});
