import { BotInstanceData } from '../types';

export interface InstanceNavigationCallbacks {
  onSwitchInstance: (instanceId: number | string) => void;
  getLoadedInstances: () => BotInstanceData[];
  getSelectedInstanceId: () => number | null;
}

export class InstanceNavigationManager {
  private callbacks?: InstanceNavigationCallbacks;
  private isShortcutsBound = false;

  public setCallbacks(callbacks: InstanceNavigationCallbacks): void {
    this.callbacks = callbacks;
  }

  public init(): void {
    this.initKeyboardShortcuts();
    this.bindDomButtons();
    this.updateNavigationUI();
  }

  /**
   * Obtiene la lista de instancias filtradas según el criterio (activas o todas).
   * Si filterActive=true pero no hay ninguna activa, hace fallback a todas las instancias cargadas (KISS/Robustez).
   */
  public getTargetInstances(filterActive: boolean = false): BotInstanceData[] {
    const all = this.callbacks?.getLoadedInstances() || [];
    if (!filterActive) return all;

    const activeList = all.filter((i) => (i.status || '').toUpperCase() === 'ACTIVE');
    return activeList.length > 0 ? activeList : all;
  }

  /**
   * Calcula el siguiente bot en la secuencia circular.
   */
  public getNextInstance(filterActive: boolean = false): BotInstanceData | null {
    const list = this.getTargetInstances(filterActive);
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];

    const currentId = this.callbacks?.getSelectedInstanceId();
    const currentIndex = list.findIndex((i) => i.id === currentId);

    if (currentIndex === -1) {
      return list[0];
    }

    const nextIndex = (currentIndex + 1) % list.length;
    return list[nextIndex];
  }

  /**
   * Calcula el bot anterior en la secuencia circular.
   */
  public getPrevInstance(filterActive: boolean = false): BotInstanceData | null {
    const list = this.getTargetInstances(filterActive);
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];

    const currentId = this.callbacks?.getSelectedInstanceId();
    const currentIndex = list.findIndex((i) => i.id === currentId);

    if (currentIndex === -1) {
      return list[list.length - 1];
    }

    const prevIndex = (currentIndex - 1 + list.length) % list.length;
    return list[prevIndex];
  }

  /**
   * Navega hacia la siguiente instancia.
   */
  public navigateNext(filterActive: boolean = false): boolean {
    const nextInst = this.getNextInstance(filterActive);
    if (!nextInst) return false;

    if (this.callbacks?.onSwitchInstance) {
      this.callbacks.onSwitchInstance(nextInst.id);
      this.updateNavigationUI();
      return true;
    }
    return false;
  }

  /**
   * Navega hacia la instancia anterior.
   */
  public navigatePrev(filterActive: boolean = false): boolean {
    const prevInst = this.getPrevInstance(filterActive);
    if (!prevInst) return false;

    if (this.callbacks?.onSwitchInstance) {
      this.callbacks.onSwitchInstance(prevInst.id);
      this.updateNavigationUI();
      return true;
    }
    return false;
  }

  /**
   * Determina si el evento de teclado ocurre dentro de un campo de entrada editable.
   */
  public isEditableElement(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tagName = el.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
    return el.isContentEditable;
  }

  /**
   * Configura los atajos de teclado globales:
   * - `[` o `Alt+ArrowLeft`: Instancia anterior
   * - `]` o `Alt+ArrowRight`: Siguiente instancia
   */
  public initKeyboardShortcuts(): void {
    if (this.isShortcutsBound) return;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo en un input/textarea
      if (this.isEditableElement(e.target)) return;

      const isNextShortcut = e.key === ']' || (e.altKey && e.key === 'ArrowRight');
      const isPrevShortcut = e.key === '[' || (e.altKey && e.key === 'ArrowLeft');

      if (isNextShortcut) {
        e.preventDefault();
        this.navigateNext(false);
      } else if (isPrevShortcut) {
        e.preventDefault();
        this.navigatePrev(false);
      }
    });

    this.isShortcutsBound = true;
  }

  /**
   * Vincula los botones de la interfaz gráfica si están presentes en el DOM.
   */
  public bindDomButtons(): void {
    const btnPrev = document.getElementById('btn-prev-instance');
    const btnNext = document.getElementById('btn-next-instance');

    if (btnPrev) {
      btnPrev.onclick = (e) => {
        e.preventDefault();
        this.navigatePrev(false);
      };
    }

    if (btnNext) {
      btnNext.onclick = (e) => {
        e.preventDefault();
        this.navigateNext(false);
      };
    }
  }

  /**
   * Actualiza el contador y el estado de habilitación de los botones en la barra de navegación.
   */
  public updateNavigationUI(): void {
    const all = this.callbacks?.getLoadedInstances() || [];
    const currentId = this.callbacks?.getSelectedInstanceId();
    const btnPrev = document.getElementById('btn-prev-instance') as HTMLButtonElement | null;
    const btnNext = document.getElementById('btn-next-instance') as HTMLButtonElement | null;
    const counterEl = document.getElementById('header-instance-counter');

    const total = all.length;
    const currentIndex = all.findIndex((i) => i.id === currentId);
    const displayIndex = currentIndex !== -1 ? currentIndex + 1 : total > 0 ? 1 : 0;

    if (counterEl) {
      if (total > 0) {
        counterEl.innerText = `${displayIndex}/${total}`;
        counterEl.title = `Instancia ${displayIndex} de ${total} registradas`;
      } else {
        counterEl.innerText = `--`;
      }
    }

    const disabled = total <= 1;
    if (btnPrev) {
      btnPrev.disabled = disabled;
      btnPrev.style.opacity = disabled ? '0.4' : '1';
      btnPrev.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
    if (btnNext) {
      btnNext.disabled = disabled;
      btnNext.style.opacity = disabled ? '0.4' : '1';
      btnNext.style.cursor = disabled ? 'not-allowed' : 'pointer';
    }
  }
}

export const instanceNavigationManager = new InstanceNavigationManager();
