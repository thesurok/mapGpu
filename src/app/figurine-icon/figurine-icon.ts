import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-figurine-icon',
  imports: [],
  templateUrl: './figurine-icon.html',
  styleUrl: './figurine-icon.css',
  host: {
    '[attr.data-figurine]': 'name()',
    '[attr.data-collected]': 'collected()',
  },
})
export class FigurineIcon {
  readonly name = input.required<string>();
  readonly collected = input(false);

  readonly src = computed(
    () => `/figurine-icons/${this.name()}-${this.collected() ? 'full' : 'empty'}.webp`,
  );

  readonly label = computed(() => {
    const title = this.name()
      .split('-')
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
      .join(' ');
    return this.collected() ? `${title}, collected` : `${title}, not collected`;
  });
}
