document.addEventListener('DOMContentLoaded', () => {
    const jsonInput = document.getElementById('jsonInput');
    const chartRequest = document.getElementById('chartRequest');
    const generateBtn = document.getElementById('generateBtn');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const canvas = document.getElementById('myChart');
    
    let chart = null;

    generateBtn.addEventListener('click', async () => {
        // Reset state
        errorEl.classList.add('hidden');
        errorEl.textContent = '';
        
        const jsonString = jsonInput.value.trim();
        const requestText = chartRequest.value.trim();

        if (!jsonString) {
            showError("Please enter some JSON data.");
            return;
        }

        if (!requestText) {
            showError("Please enter a chart request.");
            return;
        }

        let parsedData;
        try {
            parsedData = JSON.parse(jsonString);
        } catch (e) {
            showError("Invalid JSON provided. Please check your data format.");
            return;
        }

        // Show loading state
        generateBtn.disabled = true;
        loadingEl.classList.remove('hidden');
        if (chart) {
            chart.destroy();
            chart = null;
        }

        try {
            const response = await fetch('http://localhost:8000/generate-chart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data: parsedData,
                    request: requestText
                })
            });

            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(responseData.detail || "Failed to generate chart configuration.");
            }

            if (!responseData.chartConfig) {
                throw new Error("Invalid response from server: Missing chartConfig.");
            }

            // Render chart
            const chartConfig = responseData.chartConfig;
            
            chart = new Chart(canvas, chartConfig);
            
        } catch (error) {
            console.error("Error generating chart:", error);
            showError(error.message || "An unexpected error occurred.");
        } finally {
            // Hide loading state
            generateBtn.disabled = false;
            loadingEl.classList.add('hidden');
        }
    });

    function showError(message) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }
});
