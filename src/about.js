/*
 * Nội dung màn hình "Giới thiệu" — nghĩa vụ AGPL §6/§13 (chỉ tới mã nguồn) và
 * chính sách nhãn hiệu của Scratch (cụm "Based on Scratch from the MIT Media
 * Laboratory", không dùng logo/mèo Scratch ngoài nội dung thư viện).
 */
window.NextLmsScratchAbout = {
    version: '__VERSION__',
    upstream: '@scratch/scratch-gui 15.1.1',
    render () {
        const el = document.createElement('div');
        el.style.cssText = 'font: 14px/1.5 system-ui, sans-serif; color: #111; padding: 8px 4px;';
        el.innerHTML = `
            <p><strong>Trình soạn Scratch trong NextLMS</strong> — bản host ${this.version}.</p>
            <p>Based on Scratch from the MIT Media Laboratory. Trình soạn là <code>${this.upstream}</code>
            (giấy phép AGPL-3.0) được dùng nguyên vẹn; trang nhúng này cũng phát hành dưới AGPL-3.0.</p>
            <ul>
                <li>Mã nguồn trang nhúng: <a href="https://gitlab.com/codegym-vietnam/nextlms-scratch" target="_blank" rel="noopener">gitlab.com/codegym-vietnam/nextlms-scratch</a></li>
                <li>Mã nguồn trình soạn: <a href="https://github.com/scratchfoundation/scratch-editor" target="_blank" rel="noopener">github.com/scratchfoundation/scratch-editor</a></li>
                <li>Thư viện nhân vật, phông nền, âm thanh của Scratch: CC BY-SA 2.0, © Scratch Foundation.</li>
            </ul>
            <p>Tên "Scratch", logo và các nhân vật Scratch Cat, Gobo, Pico, Nano, Tera, Giga là nhãn hiệu của Scratch Foundation;
            NextLMS không được Scratch Foundation bảo trợ hay chứng nhận.</p>`;
        return el;
    }
};
