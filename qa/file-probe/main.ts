/// <reference types="vite/client" />
import './style.css';
import { capabilities, checksum, compareReadback, createProbe, errorMessage, filename, nextRevision, openSelected, readProbe, saveNewCopy, serialize, randomId, type PickerHost, type ProbeDocument, type ProbeRead, type Receipt } from './probe';
const host = window as unknown as PickerHost;
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = get('status');
const input = get<HTMLInputElement>('file-input');
let current: ProbeDocument | null = null;
let currentHash: string | null = null;
let preparedFile: File | null = null;
let source = '尚无内容';
let comparison = '尚未读回';
let busy = false;
const receipts: Receipt[] = [];
function rows(target: string, items: [string, string][]) {
  const dl = get(target); dl.replaceChildren();
  for (const [label, value] of items) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; dl.append(dt, dd);
  }
}
function refresh() {
  const support = capabilities(host, navigator, preparedFile ?? undefined);
  rows('capabilities', [['安全上下文', support.secure ? '是' : '否：增强 API 可能不可用'], ['增强读取选择器', support.open ? 'API 可用，尚不代表文件访问已授权' : '不可用：使用通用文件选择'], ['增强保存选择器', support.save ? 'API 可用，尚不代表文件访问已授权' : '不可用：使用下载副本'], ['分享当前 JSON 文件', support.shareFile ? 'canShare 支持该文件，目标由系统决定' : '不可用或当前文件类型不受支持'], ['SHA-256', crypto?.subtle ? '可用' : '不可用：不能报告校验通过']]);
  for (const id of ['generate', 'revise', 'download', 'open-picker', 'save-picker', 'share']) get<HTMLButtonElement>(id).disabled = busy;
  get<HTMLButtonElement>('generate').disabled ||= !crypto?.getRandomValues;
  get<HTMLButtonElement>('revise').disabled ||= !current || current.revision >= 1_000_000;
  get<HTMLButtonElement>('download').disabled ||= !preparedFile;
  get<HTMLButtonElement>('open-picker').disabled ||= !support.open;
  get<HTMLButtonElement>('save-picker').disabled ||= !current || !support.save || !crypto?.getRandomValues;
  get<HTMLButtonElement>('share').disabled ||= !support.shareFile;
  input.disabled = busy;
  rows('evidence', [['当前内容来源', source], ['probeId', current?.probeId ?? '—'], ['revision', current ? String(current.revision) : '—'], ['SHA-256（实际文件字节）', currentHash ?? '尚无可用校验值'], ['与本页导出基准比较', comparison], ['云盘来源 / iCloud 同步', '浏览器不可见，未验证']]);
  get('preview').textContent = current ? serialize(current) : '无内容';
}
async function adopt(document: ProbeDocument, origin: string, read?: ProbeRead) {
  const text = serialize(document);
  // Complete all fallible preparation before replacing the last valid content.
  const hash = read ? read.hash : await checksum(text, crypto);
  const file = typeof crypto?.getRandomValues === 'function' ? new File([text], filename(document, randomId(crypto)), { type: 'application/json' }) : null;
  current = document; source = origin; currentHash = hash; preparedFile = file;
  comparison = read ? ({ match: '同一 ID / revision，SHA-256 一致；仅证明读回内容一致', mismatch: '同一 ID / revision，但 SHA-256 不一致；不能算往返通过', unknown: '本页无此 ID / revision 的导出基准；请与另一设备完整校验值人工核对', unavailable: 'SHA-256 不可用，不能比较' }[compareReadback(read, receipts)]) : '尚未读回';
}
function remember(document: ProbeDocument, hash: string | null) {
  receipts.push({ probeId: document.probeId, revision: document.revision, hash });
  if (receipts.length > 32) receipts.shift();
}
function action(work: () => Promise<void>) {
  if (busy) return;
  busy = true; refresh();
  // Call synchronously; picker/share activation must not be lost to an earlier await.
  void work().catch(error => { status.textContent = errorMessage(error); }).finally(() => { busy = false; refresh(); });
}
get('generate').addEventListener('click', () => action(async () => {
  await adopt(createProbe(randomId(crypto), new Date().toISOString()), '在本页生成的合成内容');
  status.textContent = '已生成合成测试内容。尚未写入文件。';
}));
get('revise').addEventListener('click', () => action(async () => {
  if (!current) return;
  await adopt(nextRevision(current), '由已验证的合成内容递增 revision；只存在本页内存');
  status.textContent = '已准备下一 revision。原文件未改写，请导出新的副本。';
}));
input.addEventListener('cancel', () => { if (!busy) status.textContent = '已取消文件选择。当前测试内容未变更。'; });
input.addEventListener('change', () => {
  const file = input.files?.[0]; input.value = ''; // Allow selecting the same file repeatedly.
  if (!file) { status.textContent = '没有选择文件。'; return; }
  action(async () => { const read = await readProbe(file, crypto); await adopt(read.document, `通用文件选择：${read.name}（路径/云盘未知）`, read); status.textContent = '已读取并验证选中的测试文件。文件来源和同步状态仍未知。'; });
});
get('open-picker').addEventListener('click', () => action(async () => {
  const read = await openSelected(host, crypto);
  await adopt(read.document, `增强选择器：${read.name}（路径/云盘未知）`, read);
  status.textContent = '已读取并验证选中的测试文件，未写入原文件。';
}));
get('download').addEventListener('click', () => action(async () => {
  if (!current) return;
  const text = serialize(current), name = filename(current, randomId(crypto));
  const file = new File([text], name, { type: 'application/json' });
  const anchor = document.createElement('a'), url = URL.createObjectURL(file);
  anchor.href = url; anchor.download = name; document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
  remember(current, await checksum(text, crypto));
  status.textContent = '已发起新副本下载。浏览器不提供下载完成/保存位置证明；请手动选回文件验证。';
}));
get('save-picker').addEventListener('click', () => action(async () => {
  if (!current) return;
  const candidate = current;
  const read = await saveNewCopy(host, candidate, filename(candidate, randomId(crypto)), crypto);
  remember(candidate, read.hash);
  await adopt(read.document, `新副本写入后本机读回：${read.name}（路径/云盘未知）`, read);
  status.textContent = '新副本写入完成，本机读回字节一致。iCloud 同步未验证。';
}));
get('share').addEventListener('click', () => action(async () => {
  if (!preparedFile || !current) return;
  const file = new File([serialize(current)], filename(current, randomId(crypto)), { type: 'application/json' });
  if (!capabilities(host, navigator, file).shareFile) { status.textContent = '系统不支持分享这个 JSON 文件，请使用下载。'; return; }
  const candidate = current;
  await navigator.share({ files: [file] });
  remember(candidate, await checksum(serialize(candidate), crypto));
  status.textContent = '系统分享已返回。页面不知道所选目标，也不能确认文件保存或 iCloud 同步。';
}));
refresh();
