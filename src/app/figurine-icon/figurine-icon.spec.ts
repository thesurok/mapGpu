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
    fixture.componentRef.setInput('name', 'jon-lord');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('swaps the empty asset for the full asset once collected', () => {
    fixture.componentRef.setInput('collected', false);
    fixture.detectChanges();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe('figurine-icons/jon-lord-empty.webp');
    expect(img.alt).toBe('Jon Lord, not collected');

    fixture.componentRef.setInput('collected', true);
    fixture.detectChanges();
    expect(img.getAttribute('src')).toBe('figurine-icons/jon-lord-full.webp');
    expect(img.alt).toBe('Jon Lord, collected');
  });
});
