import { createElement } from "dompack/src/create";


// Remove 'on' and other unneeded attributes: we want to define onXxxx attributes which will use addEventListener instead of direct binding to the 'on' property
// Capitalize<string> removes the ATTRIBUTE_NODE etc properties
type CleanupAttributes<T> = {
  [K in keyof T as K extends `on${string}` | "childNodes" | "style" | Capitalize<string>
  ? never
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  : T[K] extends Function
  ? never
  : K]?: T[K];
};

type EventHandlersFor<E extends CustomElementName | keyof HTMLElementTagNameMap> =
  E extends keyof HTMLElementTagNameMap ? {
    on?: { [K in keyof HTMLElementEventMap]?: (this: HTMLElementTagNameMap[E], ev: HTMLElementEventMap[K]) => void; };
  } : {
    on?: { [K in keyof HTMLElementEventMap]?: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void; };
  };

type CreateAttributesFor<K extends CustomElementName | keyof HTMLElementTagNameMap> = CleanupAttributes<K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement> & EventHandlersFor<K> & {
  style?: Partial<CSSStyleDeclaration> & object;
};

type CustomElementName = `${string}-${string}`;

export function html<K extends CustomElementName | keyof HTMLElementTagNameMap>(
  elementname: K,
  attributes?: CreateAttributesFor<K>, children?: Array<Node | string>):
  K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement {
  //TODO consider making second parameter optional?
  const el = createElement(elementname, attributes, false);
  if (children?.length)
    el.append(...children);
  return el as K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : HTMLElement;
}
