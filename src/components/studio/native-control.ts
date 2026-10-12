/** Firefox can restore dynamic disabled state before React hydration.
 * DSP/session state, not browser form history, must control these fields.
 */
export const nativeControlProps = { autoComplete: "off" };
