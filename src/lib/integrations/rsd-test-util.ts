import { currentUser, switchUser } from "../session";
import { setMode, type Mode } from "./call-log";

/** For tests of other things that dispense without scanning packs: sets the RSD status, then returns to the user who was signed in. */
export function setRsdMode(mode: Mode = "off"): void {
  const back = currentUser().id;
  switchUser("U9");
  setMode("rsd", mode);
  switchUser(back);
}
