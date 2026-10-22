import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Markdown } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown file links", () => {
	afterEach(() => resetCapabilitiesCache());

	for (const filename of ["final.pdf", "Final report #1 100% café?.pdf"]) {
		it(`converts the absolute path to ${filename} into a file URL`, () => {
			setCapabilities({ images: null, trueColor: false, hyperlinks: true });
			// Forward slashes keep Windows paths intact through Markdown backslash parsing.
			const path = join(tmpdir(), filename).replaceAll("\\", "/");
			for (const width of [12, 80]) {
				const output = new Markdown(`[Final PDF](<${path}>)`, 0, 0, defaultMarkdownTheme).render(width).join("");
				const targets = [...output.matchAll(/\x1b\]8;;([^\x1b]+)\x1b\\/g)].map((match) => match[1]);
				assert.ok(targets.length > 0);
				for (const target of targets) {
					assert.equal(target, pathToFileURL(path).href);
					assert.equal(fileURLToPath(target), join(tmpdir(), filename));
				}
			}
		});
	}

	for (const target of [
		"https://example.com/report%20final.pdf#page=2",
		"mailto:test@example.com",
		"file:///tmp/report%20final.pdf",
		"./report.pdf",
		"#section",
		"//example.com/report.pdf",
	]) {
		it(`preserves the target ${target}`, () => {
			setCapabilities({ images: null, trueColor: false, hyperlinks: true });
			const output = new Markdown(`[Report](<${target}>)`, 0, 0, defaultMarkdownTheme).render(80).join("");
			assert.ok(output.includes(`\x1b]8;;${target}\x1b\\`));
		});
	}

	it("keeps the original path visible when hyperlinks are disabled", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		const path = join(tmpdir(), "Final report.pdf").replaceAll("\\", "/");
		const output = new Markdown(`[Final PDF](<${path}>)`, 0, 0, defaultMarkdownTheme)
			.render(200)
			.join("")
			.replace(/\x1b\[[0-9;]*m/g, "")
			.trimEnd();
		assert.equal(output, `Final PDF (${path})`);
	});
});
