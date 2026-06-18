const SelectionHook = require("selection-hook");
const readline = require("node:readline");

const WINDOWS_PREDEFINED_BLACKLIST = [
  "explorer.exe",
  "snipaste.exe",
  "pixpin.exe",
  "sharex.exe",
  "excel.exe",
  "powerpnt.exe",
  "photoshop.exe",
  "illustrator.exe",
  "adobe premiere pro.exe",
  "afterfx.exe",
  "adobe audition.exe",
  "blender.exe",
  "3dsmax.exe",
  "maya.exe",
  "acad.exe",
  "sldworks.exe",
  "mstsc.exe",
];

const WINDOWS_EXCLUDE_CLIPBOARD_CURSOR_DETECT = ["acrobat.exe", "wps.exe", "cajviewer.exe"];
const WINDOWS_INCLUDE_CLIPBOARD_DELAY_READ = [
  "acrobat.exe",
  "wps.exe",
  "cajviewer.exe",
  "foxitphantom.exe",
];

let hook;
function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitError(message) {
  emit({ type: "error", message });
}

function emitCurrentSelectionError(requestId, message) {
  emit({ type: "current-selection-error", requestId, message });
}

function emitToolbarAction(action, payload = {}) {
  emit({ type: "toolbar-action", action, ...payload });
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isUsablePoint(point) {
  return (
    point &&
    numberValue(point.x) !== null &&
    numberValue(point.y) !== null &&
    point.x !== SelectionHook.INVALID_COORDINATE &&
    point.y !== SelectionHook.INVALID_COORDINATE
  );
}

function samePoint(left, right) {
  return isUsablePoint(left) && isUsablePoint(right) && left.x === right.x && left.y === right.y;
}

function sameLine(startTop, startBottom, endTop, endBottom) {
  return (
    isUsablePoint(startTop) &&
    isUsablePoint(startBottom) &&
    isUsablePoint(endTop) &&
    isUsablePoint(endBottom) &&
    startTop.y === endTop.y &&
    startBottom.y === endBottom.y
  );
}

function point(x, y) {
  return { x: Math.round(x), y: Math.round(y) };
}

function pointFrom(value, yOffset = 0) {
  if (!isUsablePoint(value)) return null;
  return point(value.x, value.y + yOffset);
}

function firstUsablePoint(...values) {
  for (const value of values) {
    const next = pointFrom(value);
    if (next) return next;
  }
  return null;
}

function referencePoint(selectionData) {
  switch (selectionData.posLevel) {
    case SelectionHook.PositionLevel.MOUSE_SINGLE:
      return pointFrom(selectionData.mousePosEnd, 16);
    case SelectionHook.PositionLevel.MOUSE_DUAL: {
      if (!isUsablePoint(selectionData.mousePosStart) || !isUsablePoint(selectionData.mousePosEnd)) {
        return firstUsablePoint(selectionData.endBottom, selectionData.mousePosEnd, selectionData.startBottom);
      }
      const yDistance = selectionData.mousePosEnd.y - selectionData.mousePosStart.y;
      const xDistance = selectionData.mousePosEnd.x - selectionData.mousePosStart.x;
      if (Math.abs(yDistance) > 14) {
        return pointFrom(selectionData.mousePosEnd, yDistance > 0 ? 16 : -16);
      }
      return point(
        selectionData.mousePosEnd.x,
        (xDistance > 0
          ? Math.max(selectionData.mousePosEnd.y, selectionData.mousePosStart.y)
          : Math.min(selectionData.mousePosEnd.y, selectionData.mousePosStart.y)) + 16,
      );
    }
    case SelectionHook.PositionLevel.SEL_FULL:
    case SelectionHook.PositionLevel.SEL_DETAILED: {
      const hasMouse = isUsablePoint(selectionData.mousePosStart) && isUsablePoint(selectionData.mousePosEnd);
      if (!hasMouse) {
        return pointFrom(selectionData.endBottom, 4);
      }
      const isDoubleClick = samePoint(selectionData.mousePosStart, selectionData.mousePosEnd);
      const isSingleLine = sameLine(
        selectionData.startTop,
        selectionData.startBottom,
        selectionData.endTop,
        selectionData.endBottom,
      );
      if (isDoubleClick && isSingleLine) {
        return point(selectionData.mousePosEnd.x, selectionData.endBottom.y + 4);
      }
      if (isSingleLine) {
        const direction = selectionData.mousePosEnd.x - selectionData.mousePosStart.x;
        return pointFrom(direction > 0 ? selectionData.endBottom : selectionData.startBottom, 4);
      }
      const direction = selectionData.mousePosEnd.y - selectionData.mousePosStart.y;
      return pointFrom(direction > 0 ? selectionData.endBottom : selectionData.startTop, direction > 0 ? 4 : -4);
    }
    default:
      return firstUsablePoint(selectionData.endBottom, selectionData.mousePosEnd, selectionData.startBottom);
  }
}

function selectedText(selectionData) {
  return typeof selectionData.text === "string" ? selectionData.text.trim() : "";
}

function captureFromSelection(selectionData) {
  const text = selectedText(selectionData);
  if (!text) {
    return {
      type: "selection-missed",
      reason: "empty-selection",
      programName: selectionData.programName || "",
      method: selectionData.method,
      posLevel: selectionData.posLevel,
    };
  }
  const anchor = referencePoint(selectionData);
  if (!anchor) {
    return {
      type: "selection-missed",
      reason: "missing-position",
      programName: selectionData.programName || "",
      method: selectionData.method,
      posLevel: selectionData.posLevel,
    };
  }
  return {
    type: "selection",
    text,
    anchorX: anchor.x,
    anchorY: anchor.y,
    programName: selectionData.programName || "",
    method: selectionData.method,
    posLevel: selectionData.posLevel,
  };
}

function queryCurrentSelection(requestId) {
  try {
    const selectionData = hook.getCurrentSelection();
    const text = selectionData ? selectedText(selectionData) : "";
    emit({
      type: "current-selection",
      requestId,
      text: text || null,
      programName: selectionData?.programName || "",
    });
  } catch (error) {
    emitCurrentSelectionError(requestId, error && error.message ? error.message : String(error));
  }
}

function handleCommand(command) {
  if (!command || command.type !== "current-selection") {
    return;
  }
  const requestId = Number.isSafeInteger(command.requestId) ? command.requestId : null;
  if (requestId === null) {
    emitError("current-selection requestId is invalid");
    return;
  }
  queryCurrentSelection(requestId);
}

function startCommandReader() {
  const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on("line", (line) => {
    if (!line.trim()) return;
    try {
      handleCommand(JSON.parse(line));
    } catch (error) {
      emitError(error && error.message ? error.message : String(error));
    }
  });
}

function configureHook() {
  hook.setGlobalFilterMode(SelectionHook.FilterMode.EXCLUDE_LIST, WINDOWS_PREDEFINED_BLACKLIST);
  hook.setFineTunedList(
    SelectionHook.FineTunedListType.EXCLUDE_CLIPBOARD_CURSOR_DETECT,
    WINDOWS_EXCLUDE_CLIPBOARD_CURSOR_DETECT,
  );
  hook.setFineTunedList(
    SelectionHook.FineTunedListType.INCLUDE_CLIPBOARD_DELAY_READ,
    WINDOWS_INCLUDE_CLIPBOARD_DELAY_READ,
  );
  hook.setSelectionPassiveMode(false);
}

function cleanup() {
  if (!hook) return;
  try {
    hook.stop();
    hook.cleanup();
  } catch (error) {
    emitError(error && error.message ? error.message : String(error));
  }
}

function main() {
  hook = new SelectionHook();
  configureHook();

  hook.on("text-selection", (selectionData) => {
    const capture = captureFromSelection(selectionData);
    if (capture) {
      emit(capture);
    }
  });
  hook.on("mouse-down", (data) => {
    emitToolbarAction("mouse-down", {
      x: Math.round(numberValue(data?.x) ?? SelectionHook.INVALID_COORDINATE),
      y: Math.round(numberValue(data?.y) ?? SelectionHook.INVALID_COORDINATE),
    });
  });
  hook.on("mouse-wheel", () => emitToolbarAction("mouse-wheel"));
  hook.on("key-down", (data) => {
    emitToolbarAction("key-down", { vkCode: numberValue(data?.vkCode) ?? 0, sys: Boolean(data?.sys) });
  });
  hook.on("status", (status) => emit({ type: "status", status }));
  hook.on("error", (error) => emitError(error && error.message ? error.message : String(error)));

  const started = hook.start({ debug: process.env.QUICK_BAR_SELECTION_HOOK_DEBUG === "1" });
  if (!started) {
    emitError("selection-hook start failed");
    process.exitCode = 1;
    return;
  }

  startCommandReader();
  emit({ type: "ready" });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

main();
