lucide.createIcons();

// 动态判断后端地址
const API_BASE = (() => {
    // 生产环境：部署在 GitHub Pages 上时，使用 Render 后端
    if (window.location.hostname === 'gvljx.github.io') {
        return 'https://tu-pian-ti-qu-xin-xi.onrender.com';
    }
    // 本地开发：file:// 协议 或 localhost
    if (window.location.protocol === 'file:' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost') {
        return 'http://127.0.0.1:8080';
    }
    // 其他情况（理论上不会发生）也指向本地
    return 'http://127.0.0.1:8080';
})();

const apiUrl = `${API_BASE}/api/extract`;  // 确保这里的路径与后端路由一致

let currentBase64Image = null;
let imageMimeType = null;
let recognitionStartTime = null;

let zoomScale = 1.0;
let isDragging = false;
let hasSelection = false;
let startX = 0;
let startY = 0;

let panX = 0;
let panY = 0;

let activeMode = 'select';
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let scrollStartX = 0;
let scrollStartY = 0;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadPrompt = document.getElementById('upload-prompt');
const previewContainer = document.getElementById('preview-container');
const imagePreview = document.getElementById('image-preview');
const imgSpecs = document.getElementById('img-specs');

const btnClear = document.getElementById('btn-clear');
const btnExtract = document.getElementById('btn-extract');
const btnReuploadOverlay = document.getElementById('btn-reupload-overlay');
const btnText = document.getElementById('btn-text');

const statusBadge = document.getElementById('status-badge');
const timeBadge = document.getElementById('time-badge');
const timeVal = document.getElementById('time-val');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingTitle = document.getElementById('loading-title');
const loadingSubtitle = document.getElementById('loading-subtitle');
const tipsAlert = document.getElementById('tips-alert');
const tipsContent = document.getElementById('tips-content');

const btnCopy = document.getElementById('btn-copy');
const btnDownload = document.getElementById('btn-download');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const toastIcon = document.getElementById('toast-icon');

const imageWrapper = document.getElementById('image-wrapper');
const selectionMask = document.getElementById('selection-mask');
const selectionBox = document.getElementById('selection-box');
const btnClearSelection = document.getElementById('btn-clear-selection');

const promptIcon = document.getElementById('prompt-icon');
const promptText = document.getElementById('prompt-text');

const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const zoomLevel = document.getElementById('zoom-level');
const btnRotateCcw = document.getElementById('btn-rotate-ccw');
const btnRotateCw = document.getElementById('btn-rotate-cw');
const btnModeSelect = document.getElementById('btn-mode-select');
const btnModePan = document.getElementById('btn-mode-pan');
const apiStatus = document.getElementById('api-status');

function parseApiError(detail) {
    if (!detail) return '未知错误';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        return detail.map(item => item.msg || JSON.stringify(item)).join('; ');
    }
    return String(detail);
}

async function checkApiHealth() {
    try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.configured) {
            apiStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200';
            apiStatus.innerHTML = '<span class="w-1.5 h-1.5 mr-1.5 rounded-full bg-amber-500"></span>API 未配置，请设置 ZHIPU_API_KEY';
        } else {
            apiStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
            apiStatus.innerHTML = `<span class="w-1.5 h-1.5 mr-1.5 rounded-full bg-emerald-500 animate-pulse"></span>API 已连接 (${data.model || 'GLM-4V-Plus'})`;
        }
    } catch {
        apiStatus.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200';
        apiStatus.innerHTML = '<span class="w-1.5 h-1.5 mr-1.5 rounded-full bg-rose-500"></span>后端未连接，请确认 8080 端口服务已启动';
    }
}
checkApiHealth();

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        if (activeMode === 'select') dropZone.classList.add('drag-over');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
});

dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        handleImageFile(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleImageFile(e.target.files[0]);
    }
});

window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            handleImageFile(blob);
            showToast('已从剪贴板读取粘贴的图片');
            break;
        }
    }
});

btnReuploadOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast('上传失败：必须为图片类型文件', 'alert-triangle', 'text-amber-500');
        return;
    }

    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    imgSpecs.textContent = `文件大小: ${sizeInMB} MB`;
    imgSpecs.classList.remove('hidden');

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
        const base64Data = reader.result;
        currentBase64Image = base64Data.split(',')[1];
        imageMimeType = file.type;

        imagePreview.src = base64Data;
        uploadPrompt.classList.add('hidden');
        previewContainer.classList.remove('hidden');

        selectionMask.classList.remove('hidden');
        clearSelection();
        resetZoom();
        setMode('select', true);

        dropZone.style.overflow = 'hidden';

        btnClear.removeAttribute('disabled');
        btnExtract.removeAttribute('disabled');

        updateStatus('待识别', 'bg-blue-50 text-blue-700 border border-blue-200');
        timeBadge.classList.add('hidden');
        resultText.value = '';
        resultText.setAttribute('readonly', 'true');
        btnCopy.setAttribute('disabled', 'true');
        btnDownload.setAttribute('disabled', 'true');
        tipsAlert.classList.add('hidden');

        const img = new Image();
        img.src = base64Data;
        img.onload = function() {
            imgSpecs.textContent = `尺寸: ${this.width} x ${this.height} | 大小: ${sizeInMB} MB`;
            if (this.width < 500 || this.height < 500) {
                showLowResolutionWarning('图片分辨率偏低，提取效果可能会受到影响，建议上传更高清晰度的原图。');
            }
        };
    };
}

btnClear.addEventListener('click', () => {
    resetAll();
});

function resetAll() {
    currentBase64Image = null;
    imageMimeType = null;
    fileInput.value = '';

    imagePreview.src = '';
    uploadPrompt.classList.remove('hidden');
    previewContainer.classList.add('hidden');
    imgSpecs.classList.add('hidden');
    selectionMask.classList.add('hidden');
    clearSelection();
    resetZoom();
    setMode('select', true);
    dropZone.style.overflow = 'auto';

    btnClear.setAttribute('disabled', 'true');
    btnExtract.setAttribute('disabled', 'true');

    resultText.value = '';
    resultText.setAttribute('readonly', 'true');
    btnCopy.setAttribute('disabled', 'true');
    btnDownload.setAttribute('disabled', 'true');
    tipsAlert.classList.add('hidden');
    updateStatus('待上传', 'bg-slate-100 text-slate-600');
    timeBadge.classList.add('hidden');
}

function startDrag(e) {
    if (e.target === btnClearSelection || btnClearSelection.contains(e.target)) {
        return;
    }

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    if (activeMode === 'pan') {
        isPanning = true;
        selectionMask.style.cursor = 'grabbing';
        panStartX = clientX;
        panStartY = clientY;
        scrollStartX = panX;
        scrollStartY = panY;
    } else {
        isDragging = true;
        const rect = selectionMask.getBoundingClientRect();
        startX = (clientX - rect.left) / zoomScale;
        startY = (clientY - rect.top) / zoomScale;

        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.classList.remove('hidden');
    }
}

function drag(e) {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    if (isPanning) {
        const dx = clientX - panStartX;
        const dy = clientY - panStartY;
        panX = scrollStartX + dx;
        panY = scrollStartY + dy;
        updateZoomAndPan();
        return;
    }

    if (!isDragging) return;

    if (e.cancelable) {
        e.preventDefault();
    }

    const rect = selectionMask.getBoundingClientRect();
    const maxUnscaledWidth = rect.width / zoomScale;
    const maxUnscaledHeight = rect.height / zoomScale;

    const currentX = Math.max(0, Math.min((clientX - rect.left) / zoomScale, maxUnscaledWidth));
    const currentY = Math.max(0, Math.min((clientY - rect.top) / zoomScale, maxUnscaledHeight));

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(startX - currentX);
    const height = Math.abs(startY - currentY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
}

function endDrag() {
    if (isPanning) {
        isPanning = false;
        selectionMask.style.cursor = 'grab';
        return;
    }

    if (!isDragging) return;
    isDragging = false;

    const width = parseFloat(selectionBox.style.width) || 0;
    const height = parseFloat(selectionBox.style.height) || 0;

    if (width > 15 && height > 15) {
        hasSelection = true;
        btnText.textContent = "开始提取选区文字";
        btnExtract.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        btnExtract.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        showToast('已框选局部提取范围', 'crop', 'text-indigo-400');
    } else {
        clearSelection();
    }
}

function clearSelection() {
    hasSelection = false;
    selectionBox.classList.add('hidden');
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    btnText.textContent = "开始提取文字";
    btnExtract.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
    btnExtract.classList.add('bg-blue-600', 'hover:bg-blue-700');
}

selectionMask.addEventListener('mousedown', startDrag);
window.addEventListener('mousemove', drag);
window.addEventListener('mouseup', endDrag);

selectionMask.addEventListener('touchstart', startDrag, { passive: false });
window.addEventListener('touchmove', drag, { passive: false });
window.addEventListener('touchend', endDrag);

btnClearSelection.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    clearSelection();
    showToast('已取消选区，恢复全图提取');
});

function getCroppedBase64() {
    if (!hasSelection) return currentBase64Image;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const boxRect = selectionBox.getBoundingClientRect();
    const imgRect = imagePreview.getBoundingClientRect();

    const scaleX = imagePreview.naturalWidth / imgRect.width;
    const scaleY = imagePreview.naturalHeight / imgRect.height;

    const sx = (boxRect.left - imgRect.left) * scaleX;
    const sy = (boxRect.top - imgRect.top) * scaleY;
    const sWidth = boxRect.width * scaleX;
    const sHeight = boxRect.height * scaleY;

    canvas.width = sWidth;
    canvas.height = sHeight;

    ctx.drawImage(imagePreview, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    return canvas.toDataURL(imageMimeType).split(',')[1];
}

function updateZoomAndPan() {
    imageWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    zoomLevel.textContent = `${Math.round(zoomScale * 100)}%`;
}

function zoomIn() {
    if (zoomScale < 3.0) {
        zoomScale += 0.25;
        updateZoomAndPan();
    } else {
        showToast('已达到最大放大比例（300%）', 'zoom-in', 'text-amber-400');
    }
}

function zoomOut() {
    if (zoomScale > 0.5) {
        zoomScale -= 0.25;
        updateZoomAndPan();
    } else {
        showToast('已达到最小缩小比例（50%）', 'zoom-out', 'text-amber-400');
    }
}

function resetZoom() {
    zoomScale = 1.0;
    panX = 0;
    panY = 0;
    updateZoomAndPan();
}

function rotateImage(clockwise = true) {
    if (!imagePreview.src || !currentBase64Image) return;

    setLoading(true, "正在旋转图片...", "请稍候");

    const img = new Image();
    img.src = imagePreview.src;
    img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = img.height;
        canvas.height = img.width;

        if (clockwise) {
            ctx.translate(canvas.width, 0);
            ctx.rotate(90 * Math.PI / 180);
        } else {
            ctx.translate(0, canvas.height);
            ctx.rotate(-90 * Math.PI / 180);
        }

        ctx.drawImage(img, 0, 0);

        const rotatedBase64 = canvas.toDataURL(imageMimeType);
        currentBase64Image = rotatedBase64.split(',')[1];
        imagePreview.src = rotatedBase64;

        const sizeInMB = (rotatedBase64.length * 0.75 / (1024 * 1024)).toFixed(2);
        imgSpecs.textContent = `尺寸: ${canvas.width} x ${canvas.height} | 大小: ${sizeInMB} MB`;

        clearSelection();
        panX = 0;
        panY = 0;
        updateZoomAndPan();

        setLoading(false);
        showToast(clockwise ? '已顺时针旋转 90°' : '已逆时针旋转 90°', 'refresh-cw', 'text-blue-400');
    };
}

function setMode(mode, silent = false) {
    activeMode = mode;
    if (mode === 'select') {
        btnModeSelect.classList.add('text-blue-400', 'bg-slate-800/80');
        btnModeSelect.classList.remove('hover:text-blue-400');
        btnModePan.classList.remove('text-blue-400', 'bg-slate-800/80');
        btnModePan.classList.add('hover:text-blue-400');

        selectionMask.style.cursor = 'crosshair';
        promptText.textContent = "拖拽鼠标可选择提取范围";
        promptIcon.setAttribute('data-lucide', 'mouse-pointer-square-dashed');

        if (!silent) showToast('已进入框选模式，拖拽框选文字范围', 'mouse-pointer-square-dashed', 'text-blue-400');
    } else {
        btnModePan.classList.add('text-blue-400', 'bg-slate-800/80');
        btnModePan.classList.remove('hover:text-blue-400');
        btnModeSelect.classList.remove('text-blue-400', 'bg-slate-800/80');
        btnModeSelect.classList.add('hover:text-blue-400');

        selectionMask.style.cursor = 'grab';
        promptText.textContent = "按住鼠标左键可拖拽移动视图";
        promptIcon.setAttribute('data-lucide', 'hand');

        if (!silent) showToast('已进入移动模式，支持全方位无限制拖拽漫游图片', 'hand', 'text-blue-400');
    }
    lucide.createIcons();
}

btnModeSelect.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode('select');
});

btnModePan.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode('pan');
});

btnZoomIn.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomIn();
});

btnZoomOut.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomOut();
});

btnRotateCcw.addEventListener('click', (e) => {
    e.stopPropagation();
    rotateImage(false);
});

btnRotateCw.addEventListener('click', (e) => {
    e.stopPropagation();
    rotateImage(true);
});

btnExtract.addEventListener('click', async () => {
    if (!currentBase64Image) return;

    const targetBase64 = hasSelection ? getCroppedBase64() : currentBase64Image;
    const statusLabel = hasSelection ? "正在提取选区文字..." : "正在提取文字...";

    setLoading(true, statusLabel, "智谱 GLM-4V-Plus 正在深度识别文字与版式");
    updateStatus('识别中', 'bg-amber-100 text-amber-700 animate-pulse');
    recognitionStartTime = performance.now();

    const maxRetries = 5;
    let attempt = 0;
    let success = false;
    let responseData = null;

    const fullDataUrl = `data:${imageMimeType};base64,${targetBase64}`;

    const ocrPrompt = "请把图片中出现的全部文字提取并展示出来。保留原本的自然段落分行和大概排版顺序。直接输出提取出的文本内容，不需要加入任何多余的前言、结语、标号或解释。若没有文字，则输出'未在指定区域内检测到明显的文字。'";

    while (attempt < maxRetries && !success) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_url: fullDataUrl,
                    prompt: ocrPrompt
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(parseApiError(errorData.detail) || `HTTP ${response.status}`);
            }

            responseData = await response.json();
            success = true;
        } catch (err) {
            attempt++;
            if (attempt >= maxRetries) {
                handleFailure(err);
                return;
            }
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (success && responseData) {
        handleSuccess(responseData);
    }
});

function handleSuccess(data) {
    setLoading(false);
    const endTime = performance.now();
    const duration = ((endTime - recognitionStartTime) / 1000).toFixed(1);

    let extractedText = data.choices?.[0]?.message?.content || '';

    extractedText = extractedText.trim();
    if (extractedText.startsWith('```') && extractedText.endsWith('```')) {
        extractedText = extractedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
    }

    resultText.value = extractedText;
    resultText.removeAttribute('readonly');

    btnCopy.removeAttribute('disabled');
    btnDownload.removeAttribute('disabled');

    updateStatus('识别成功', 'bg-emerald-50 text-emerald-700 border border-emerald-200');
    timeVal.textContent = `${duration}s`;
    timeBadge.classList.remove('hidden');

    showToast('文字提取成功', 'check-circle', 'text-emerald-400');

    if (extractedText.length < 5 || extractedText.includes('未在指定区域内检测到明显的文字')) {
        showLowResolutionWarning('无法很好地提取文字，可能是由于选择区域过小、缺乏文本内容、文字过小或清晰度不佳。您可以重新选择更大的清晰区域。');
    }
}

function handleFailure(error) {
    setLoading(false);
    updateStatus('识别失败', 'bg-rose-50 text-rose-700 border border-rose-200');
    resultText.value = '文字识别失败，请检查您的网络连接或稍后重试。\n\n技术原因: ' + error.message;
    showToast('识别失败，请重试', 'x-circle', 'text-rose-500');
}

btnCopy.addEventListener('click', async () => {
    const textToCopy = resultText.value;
    if (!textToCopy) return;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(textToCopy);
        } else {
            const tempTextarea = document.createElement('textarea');
            tempTextarea.value = textToCopy;
            document.body.appendChild(tempTextarea);
            tempTextarea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextarea);
        }
        showToast('已成功复制到剪贴板！', 'check-circle', 'text-emerald-400');
    } catch {
        showToast('复制失败，请手动选择复制', 'x-circle', 'text-rose-400');
    }
});

btnDownload.addEventListener('click', () => {
    const textContent = resultText.value;
    if (!textContent) return;

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `提取文字_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('已开始下载文本文件', 'download-cloud', 'text-blue-400');
});

function updateStatus(text, badgeClass) {
    statusBadge.className = `inline-flex items-center px-2 py-0.5 rounded font-medium ${badgeClass}`;
    statusBadge.textContent = text;
}

function setLoading(isLoading, title = "", subtitle = "") {
    if (isLoading) {
        loadingTitle.textContent = title;
        loadingSubtitle.textContent = subtitle;
        loadingOverlay.classList.remove('hidden');
        btnExtract.setAttribute('disabled', 'true');
        if (hasSelection) {
            btnText.textContent = "正在努力提取选区...";
        } else {
            btnText.textContent = "正在努力提取...";
        }
    } else {
        loadingOverlay.classList.add('hidden');
        btnExtract.removeAttribute('disabled');
        if (hasSelection) {
            btnText.textContent = "开始提取选区文字";
        } else {
            btnText.textContent = "开始提取文字";
        }
    }
}

function showLowResolutionWarning(message) {
    tipsContent.textContent = message;
    tipsAlert.classList.remove('hidden');
}

function showToast(message, iconName = 'check-circle', iconColorClass = 'text-emerald-400') {
    toastMsg.textContent = message;
    toastIcon.className = `w-4 h-4 ${iconColorClass}`;
    toastIcon.setAttribute('data-lucide', iconName);
    lucide.createIcons();

    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 2500);
}
