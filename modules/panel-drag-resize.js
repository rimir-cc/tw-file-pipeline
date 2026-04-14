/*\
title: $:/plugins/rimir/file-pipeline/modules/panel-drag-resize.js
type: application/javascript
module-type: startup

Adds drag-to-move (via header) and edge/corner resize to .fp-select-panel

\*/
(function() {

"use strict";

exports.name = "fp-panel-drag-resize";
exports.platforms = ["browser"];
exports.after = ["render"];

var EDGE = 6;
var MIN_W = 360;
var MIN_H = 250;
var SELECTOR = ".fp-select-panel";
var HEADER_SELECTOR = ".fp-select-header";

exports.startup = function() {
	var state = null;

	document.addEventListener("mousedown", function(e) {
		var panel = findPanel(e.target);
		if(!panel) return;

		// Check if dragging from header (move) or edge (resize)
		var header = e.target.closest(HEADER_SELECTOR);
		if(header && header.closest(SELECTOR) === panel) {
			// Don't capture clicks on buttons inside the header
			if(e.target.closest("button")) return;

			e.preventDefault();
			e.stopImmediatePropagation();
			pinPanel(panel);
			var rect = panel.getBoundingClientRect();
			state = {
				panel: panel,
				mode: "move",
				startX: e.clientX,
				startY: e.clientY,
				startLeft: rect.left,
				startTop: rect.top
			};
			document.body.style.cursor = "grabbing";
			document.body.style.userSelect = "none";
			document.body.style.webkitUserSelect = "none";
			return;
		}

		var zone = hitTest(panel, e.clientX, e.clientY);
		if(!zone) return;

		e.preventDefault();
		e.stopImmediatePropagation();
		pinPanel(panel);
		var rect2 = panel.getBoundingClientRect();
		state = {
			panel: panel,
			mode: "resize",
			zone: zone,
			startX: e.clientX,
			startY: e.clientY,
			startRect: { left: rect2.left, top: rect2.top, width: rect2.width, height: rect2.height }
		};
		document.body.style.cursor = cursorFor(zone);
		document.body.style.userSelect = "none";
		document.body.style.webkitUserSelect = "none";
	}, true);

	document.addEventListener("mousemove", function(e) {
		if(!state) {
			// Hover cursor
			var panel = findPanel(e.target);
			if(panel) {
				var header = e.target.closest(HEADER_SELECTOR);
				if(header && header.closest(SELECTOR) === panel && !e.target.closest("button")) {
					panel.style.cursor = "grab";
				} else {
					var zone = hitTest(panel, e.clientX, e.clientY);
					panel.style.cursor = zone ? cursorFor(zone) : "";
				}
			}
			return;
		}

		e.preventDefault();
		var dx = e.clientX - state.startX;
		var dy = e.clientY - state.startY;
		var p = state.panel;

		if(state.mode === "move") {
			p.style.left = (state.startLeft + dx) + "px";
			p.style.top = (state.startTop + dy) + "px";
			return;
		}

		// Resize
		var s = state.startRect;
		var z = state.zone;
		var newLeft = s.left, newTop = s.top, newW = s.width, newH = s.height;

		if(z.indexOf("w") !== -1) { newW = Math.max(MIN_W, s.width - dx); newLeft = s.left + s.width - newW; }
		if(z.indexOf("e") !== -1) { newW = Math.max(MIN_W, s.width + dx); }
		if(z.indexOf("n") !== -1) { newH = Math.max(MIN_H, s.height - dy); newTop = s.top + s.height - newH; }
		if(z.indexOf("s") !== -1) { newH = Math.max(MIN_H, s.height + dy); }

		p.style.left = newLeft + "px";
		p.style.top = newTop + "px";
		p.style.width = newW + "px";
		p.style.height = newH + "px";
	}, true);

	document.addEventListener("mouseup", function() {
		if(!state) return;
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		document.body.style.webkitUserSelect = "";
		state = null;
	}, true);
};

function findPanel(el) {
	return el.closest ? el.closest(SELECTOR) : null;
}

function pinPanel(panel) {
	var rect = panel.getBoundingClientRect();
	panel.style.left = rect.left + "px";
	panel.style.top = rect.top + "px";
	panel.style.right = "auto";
	panel.style.bottom = "auto";
	panel.style.transform = "none";
	panel.style.width = rect.width + "px";
	panel.style.height = rect.height + "px";
	panel.style.maxHeight = "none";
}

function hitTest(panel, cx, cy) {
	var r = panel.getBoundingClientRect();
	var inLeft = cx - r.left < EDGE;
	var inRight = r.right - cx < EDGE;
	var inTop = cy - r.top < EDGE;
	var inBottom = r.bottom - cy < EDGE;
	if(!inLeft && !inRight && !inTop && !inBottom) return null;
	var zone = "";
	if(inTop) zone += "n";
	if(inBottom) zone += "s";
	if(inLeft) zone += "w";
	if(inRight) zone += "e";
	return zone || null;
}

function cursorFor(zone) {
	var map = { n:"n-resize", s:"s-resize", w:"w-resize", e:"e-resize", nw:"nw-resize", ne:"ne-resize", sw:"sw-resize", se:"se-resize" };
	return map[zone] || "default";
}

})();
