import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FigurineIcon } from './figurine-icon';

describe('FigurineIcon', () => {
  let component: FigurineIcon;
  let fixture: ComponentFixture<FigurineIcon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FigurineIcon],
    }).compileComponents();

    fixture = TestBed.createComponent(FigurineIcon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
