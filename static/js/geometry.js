// Геометрические утилиты
const Geometry = {
    LANE_WIDTH_PX: 16,
    
    // Расстояние между двумя точками
    dist(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    },
    
    // Линейная интерполяция
    lerp(a, b, t) {
        return a + (b - a) * t;
    },
    
    // Вычисление нормали к отрезку (поворот на 90° влево)
    normal(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
    },
    
    // Смещение полилинии на заданное расстояние
    offsetPolyline(points, offset) {
        if (points.length < 2) return points.slice();
        
        const n = points.length;
        const result = new Array(n);
        
        for (let i = 0; i < n; i++) {
            let nx = 0, ny = 0;
            
            // Усредняем нормали соседних сегментов
            if (i > 0) {
                const n1 = this.normal(points[i - 1], points[i]);
                nx += n1.x;
                ny += n1.y;
            }
            
            if (i < n - 1) {
                const n2 = this.normal(points[i], points[i + 1]);
                nx += n2.x;
                ny += n2.y;
            }
            
            const len = Math.hypot(nx, ny) || 1;
            result[i] = {
                x: points[i].x + (nx / len) * offset,
                y: points[i].y + (ny / len) * offset
            };
        }
        
        return result;
    },
    
    // Найти середину полилинии и угол
    polylineMidpoint(points) {
        if (points.length < 2) {
            return { p: points[0] || {x: 0, y: 0}, angleRad: 0 };
        }
        
        // Находим самый длинный сегмент
        let maxLen = -1;
        let maxIndex = 0;
        
        for (let i = 0; i < points.length - 1; i++) {
            const len = this.dist(points[i], points[i + 1]);
            if (len > maxLen) {
                maxLen = len;
                maxIndex = i;
            }
        }
        
        const a = points[maxIndex];
        const b = points[maxIndex + 1];
        
        const p = {
            x: this.lerp(a.x, b.x, 0.5),
            y: this.lerp(a.y, b.y, 0.5)
        };
        
        const angleRad = Math.atan2(b.y - a.y, b.x - a.x);
        
        return { p, angleRad };
    },
    
    // Преобразование точек в SVG path
    pointsToPath(points) {
        if (points.length === 0) return '';
        
        let path = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
            path += ` L ${points[i].x} ${points[i].y}`;
        }
        
        return path;
    },
    
    // Генерация уникального ID
    generateId(prefix = 'id') {
        return prefix + '_' + Math.random().toString(36).substr(2, 9);
    }
};