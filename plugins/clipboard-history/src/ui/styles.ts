export const styles = `
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --text: #212121;
      --muted: #757575;
      --primary: #1976D2;
      --folders: #7C3AED;
      --outline: #E0E0E0;
      --danger: #D32F2F;
      --shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }
    * { box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); }
    .wrap { height: 100vh; display: flex; flex-direction: column; }
    .topbar {
      height: 44px;
      background: var(--surface);
      border-bottom: 1px solid var(--outline);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-shadow: var(--shadow);
      flex-shrink: 0;
      position: relative;
    }
    .dropdown { position: relative; }
    .btn {
      border: 1px solid var(--outline);
      background: var(--surface);
      color: var(--text);
      height: 30px;
      padding: 0 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 28px;
    }
    .btn.primary { border-color: transparent; background: var(--primary); color: white; }
    .btn.folders { border-color: transparent; background: var(--folders); color: white; }
    .btn.danger { border-color: transparent; background: var(--danger); color: white; }
    .btn:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .title { font-weight: 700; font-size: 13px; margin-right: auto; }
    .search {
      width: 260px;
      max-width: 45vw;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--outline);
      border-radius: 8px;
      outline: none;
      font-size: 12px;
      background: white;
    }
    .search:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .content { flex: 1; overflow: auto; padding: 10px; }
    .list {
      display: flex;
      flex-direction: column;
      gap: 0;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      overflow: hidden;
    }
    .card {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 10px 12px;
      cursor: pointer;
      position: relative;
    }
    .card + .card { border-top: 1px solid var(--outline); }
    .card:hover { background: rgba(0,0,0,0.03); }
    .cardTop { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .pill { font-size: 11px; color: var(--muted); border: 1px solid var(--outline); padding: 2px 8px; border-radius: 999px; }
    .meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
    .clipTools { display: flex; align-items: center; gap: 8px; }
    .spacer { margin-left: auto; }
    .iconBtn {
      border: 1px solid transparent;
      background: transparent;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      line-height: 26px;
      text-align: center;
      color: var(--muted);
    }
    .card:hover .iconBtn { border-color: var(--outline); background: white; }
    .iconBtn:hover { border-color: #CFCFCF; background: white; }
    .iconBtn:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .text { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
    .text.clamp {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--clamp-lines, 6);
      overflow: hidden;
    }
    .textWrap { display: flex; flex-direction: column; gap: 6px; }
    .textWrap.clipTextWrap {
      display: grid;
      grid-template-columns: 1fr auto;
      column-gap: 10px;
      row-gap: 6px;
      align-items: start;
    }
    .textWrap.clipTextWrap [data-role="clipText"] { grid-column: 1; grid-row: 1; min-width: 0; }
    .textWrap.clipTextWrap .clipTools { grid-column: 2; grid-row: 1; justify-self: end; }
    .textWrap.clipTextWrap button[data-role="foldBtn"] { grid-column: 1 / -1; grid-row: 2; }
    .foldBtn { border: none; background: transparent; color: var(--primary); cursor: pointer; font-size: 12px; padding: 0; }
    .foldBtn.hidden { display: none; }
    .imgPlaceholder {
      width: 100%;
      max-height: 220px;
      min-height: 120px;
      border: 1px dashed var(--outline);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      background: rgba(0,0,0,0.02);
    }
    .loadMoreRow { padding: 10px 12px; border-top: 1px solid var(--outline); display: flex; justify-content: center; background: var(--surface); }
    .imgWrap { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; position: relative; }
    .imgWrap .clipTools { position: absolute; top: 0; right: 0; }
    .img { display: block; max-width: 100%; max-height: 220px; object-fit: contain; border-radius: 10px; }
    .empty { color: var(--muted); text-align: center; padding: 24px 0; font-size: 13px; }
    .settings { border: 1px dashed var(--outline); background: var(--surface); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .row label { width: 120px; color: var(--muted); font-size: 12px; }
    .row input[type="number"] { width: 120px; height: 30px; border: 1px solid var(--outline); border-radius: 8px; padding: 0 8px; }

    .subbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      flex-wrap: wrap;
    }
    .crumbs { font-size: 12px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; }
    .crumb { cursor: pointer; border: 1px solid var(--outline); padding: 2px 8px; border-radius: 999px; background: white; }
    .crumb:hover { background: rgba(0,0,0,0.03); }
    .editor {
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      padding: 10px;
      box-shadow: var(--shadow);
      margin-bottom: 10px;
    }
    .fieldRow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .input {
      height: 30px;
      border: 1px solid var(--outline);
      border-radius: 8px;
      padding: 0 8px;
      outline: none;
      font-size: 12px;
      background: white;
      color: var(--text);
      flex: 1;
      min-width: 180px;
    }
    .input:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .textarea {
      width: 100%;
      min-height: 92px;
      border: 1px solid var(--outline);
      border-radius: 10px;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
      outline: none;
      resize: vertical;
      background: white;
      color: var(--text);
      margin-top: 10px;
    }
    .textarea:focus-visible { outline: 2px solid rgba(25,118,210,0.45); outline-offset: 1px; }
    .hint { margin-top: 8px; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

    .folderCardTitle { display: flex; align-items: center; gap: 8px; }
    .folderName { font-weight: 700; font-size: 13px; color: var(--text); }
    .dragHandle {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      border: 1px solid var(--outline);
      background: white;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      flex-shrink: 0;
    }
    .menu {
      position: absolute;
      top: 36px;
      right: 0;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      min-width: 260px;
      z-index: 20;
      display: none;
    }
    .menu.open { display: block; }
    .menuItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      text-align: left;
      color: var(--text);
    }
    .menuItem:hover { background: rgba(0,0,0,0.03); }
    .menuHeader { padding: 10px 12px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--outline); }

    .overlay { position: fixed; inset: 0; z-index: 80; display: none; }
    .overlay.open { display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.10); }
    .ctxMenu {
      position: absolute;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      min-width: 220px;
      z-index: 90;
    }
    .dialog {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, 92vw);
      max-height: 80vh;
      background: var(--surface);
      border: 1px solid var(--outline);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 90;
    }
    .dialogHeader { padding: 10px 12px; border-bottom: 1px solid var(--outline); display: flex; align-items: center; gap: 8px; }
    .dialogTitle { font-weight: 700; font-size: 13px; }
    .dialogBody { padding: 10px; overflow: auto; }
    .dialogList { margin-top: 10px; border: 1px solid var(--outline); border-radius: 12px; overflow: hidden; }

    .placeholder {
      border: 2px dashed rgba(25,118,210,0.45);
      background: rgba(25,118,210,0.06);
      border-radius: 12px;
      margin: 0;
    }
    .ghost {
      position: fixed;
      left: 0;
      top: 0;
      pointer-events: none;
      z-index: 50;
      opacity: 0.92;
      transform: translate(-9999px, -9999px);
    }
  `

