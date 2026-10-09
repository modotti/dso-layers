import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient()] }).compileComponents());
  it('starts with the import workflow', () => {
    const fixture = TestBed.createComponent(AppComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Build scene');
    expect(fixture.nativeElement.textContent).toContain('Reveal the space inside your image');
  });
});
