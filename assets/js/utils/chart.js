/* ==========================================================================
   MESIN RENDERING GRAFIK STATISTIK (CHART.JS MONOCHROME WRAPPER)
   Lokasi file: website/assets/js/utils/chart.js
   
   Tujuan utama file ini:
   Mencari seluruh elemen <canvas class="custom-chart"> yang dihasilkan oleh parser.js,
   mem-parsing atribut data-type dan data-data, lalu menggambar grafik interaktif
   bertema monokrom menggunakan pustaka Chart.js.
   Digunakan oleh: view.js dan create.js.
   ========================================================================== */

// Menyimpan referensi seluruh instansi grafik yang sedang aktif di layar.
// Sangat penting agar grafik lama dapat dihancurkan (.destroy()) sebelum menggambar ulang
// di Live Preview (create.html), mencegah kebocoran memori (memory leak) dan glitch hover.
/* ==========================================================================
   MESIN RENDERING GRAFIK STATISTIK (CHART.JS MONOCHROME WRAPPER)
   Lokasi file: website/assets/js/utils/chart.js
   ========================================================================== */

let activeCharts = [];
const MAX_CHART_POINTS = 300; // Batas aman mencegah pembekuan tab akibat data ekstrem

export function renderCharts(container) {
    activeCharts.forEach(chart => chart.destroy());
    activeCharts = [];

    container.querySelectorAll('.custom-chart').forEach((canvas) => {
        const type = canvas.getAttribute('data-type') === 'line' ? 'line' : 'bar';
        const rawData = canvas.getAttribute('data-data');

        const labels = [];
        const data = [];

        if (rawData) {
            const items = rawData.split(',').slice(0, MAX_CHART_POINTS);
            items.forEach(item => {
                const parts = item.split(':');
                if (parts.length === 2) {
                    const lbl = parts[0].trim();
                    const val = Number(parts[1].trim());
                    if (lbl && Number.isFinite(val)) {
                        labels.push(lbl);
                        data.push(val);
                    }
                }
            });
        }

        const ctx = canvas.getContext('2d');
        const newChart = new Chart(ctx, {
            type,
            data: {
                labels,
                datasets: [{
                    label: 'Nilai',
                    data,
                    backgroundColor: type === 'line' ? 'rgba(24, 24, 27, 0.08)' : 'rgba(24, 24, 27, 0.78)',
                    borderColor: '#18181B',
                    borderWidth: 2,
                    borderRadius: type === 'bar' ? 4 : 0,
                    tension: 0.3,
                    fill: type === 'line'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#18181B',
                        titleColor: '#FAFAFA',
                        bodyColor: '#FAFAFA',
                        padding: 10,
                        cornerRadius: 6
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#52525B' }
                    },
                    y: {
                        border: { display: false },
                        grid: { color: '#E2E2E6' },
                        ticks: { color: '#52525B' }
                    }
                }
            }
        });

        activeCharts.push(newChart);
    });
}