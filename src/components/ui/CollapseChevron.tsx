/**
 * @file CollapseChevron.tsx
 * @description Шеврон сворачивания: вниз у раскрытого блока, вправо у свёрнутого.
 *
 * Поворот делается CSS-трансформом, а не второй иконкой, — так переход между
 * состояниями читается как одно движение.
 *
 * Общий для карточки списка и верхней панели: у обеих сворачивание работает
 * одинаково, и разные иконки для одного действия сбивали бы с толку.
 */

/** Пропсы компонента `CollapseChevron`. */
type CollapseChevronProps = {
  /** Свёрнут ли блок, к которому относится шеврон. */
  isCollapsed: boolean;
};

export default function CollapseChevron({ isCollapsed }: CollapseChevronProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform duration-150 ${
        isCollapsed ? "-rotate-90" : ""
      }`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
