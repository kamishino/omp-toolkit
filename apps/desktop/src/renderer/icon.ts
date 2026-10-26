const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const pathElem = document.createElementNS(SVG_NS, "path");
  pathElem.setAttribute("d", pathData);
  pathElem.setAttribute("fill", "currentColor");
  svg.appendChild(pathElem);
  return svg;
}
