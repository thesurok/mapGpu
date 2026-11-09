import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FigurineCallout, FigurineCalloutView, placeFigurineCallout } from './figurine-callout';

describe('placeFigurineCallout', () => {
  it('opens down and to the right of the pointer when there is room', () => {
    expect(placeFigurineCallout(40, 50, 800, 600)).toEqual({ left: 56, top: 66 });
  });

  it('flips to the left when the card would leave the viewport', () => {
    const placed = placeFigurineCallout(780, 40, 800, 600);
    expect(placed.left).toBeLessThan(780);
    expect(placed.left).toBeGreaterThanOrEqual(12);
  });
});

describe('FigurineCallout', () => {
  let callout: FigurineCallout;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    callout = TestBed.inject(FigurineCallout);
    callout.close();
    callout.resumeHover();
  });

  const story = {
    id: 'jon-lord',
    title: 'Jon Lord',
    description: 'A story',
    x: 10,
    y: 20,
  };

  it('keeps a hover card in place while the pointer stays on the same cloud', () => {
    callout.hover(story);
    callout.hover({ ...story, x: 80, y: 90 });
    expect(callout.current()).toEqual({ ...story, pinned: false });
  });

  it('does not let a hover replace a pinned card', () => {
    callout.pin(story);
    callout.hover({ ...story, id: 'paradjanov', title: 'Serhii Parajanov', x: 4, y: 4 });
    expect(callout.current()?.id).toBe('jon-lord');
    expect(callout.current()?.pinned).toBe(true);
  });

  it('blocks hover from reopening a card that was just dismissed', () => {
    callout.hover(story);
    callout.dismiss();
    callout.hover(story);
    expect(callout.current()).toBeNull();
    callout.resumeHover();
    callout.hover(story);
    expect(callout.current()?.id).toBe('jon-lord');
  });
});

describe('FigurineCalloutView', () => {
  let fixture: ComponentFixture<FigurineCalloutView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FigurineCalloutView],
    }).compileComponents();
    fixture = TestBed.createComponent(FigurineCalloutView);
    await fixture.whenStable();
  });

  it('renders the title and description at the pointer', () => {
    fixture.componentInstance.callout.pin({
      id: 'jon-lord',
      title: 'Jon Lord',
      description: 'Smoke on the water.',
      x: 30,
      y: 40,
    });
    fixture.detectChanges();
    const card: HTMLElement = fixture.nativeElement.querySelector('.card');
    expect(card.textContent).toContain('Jon Lord');
    expect(card.textContent).toContain('Smoke on the water.');
    expect(card.style.left).toBe('46px');
    expect(card.style.top).toBe('56px');
  });
});
