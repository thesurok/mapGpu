import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapGpuRoot } from './map-gpu-root';

describe('MapGpuRoot', () => {
  let component: MapGpuRoot;
  let fixture: ComponentFixture<MapGpuRoot>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapGpuRoot],
    }).compileComponents();

    fixture = TestBed.createComponent(MapGpuRoot);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
