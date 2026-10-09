import { writeFileSync } from "node:fs";
import { themesCss } from "../src/themes.ts";

writeFileSync(new URL("../src/themes.css", import.meta.url), themesCss());
