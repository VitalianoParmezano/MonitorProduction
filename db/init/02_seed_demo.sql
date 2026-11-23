-- ДЕМО-ДАНІ. ПРИБРАТИ ЦЕЙ ФАЙЛ ДО ПРОДАКШНУ.
-- Створює дві моделі, одну відкриту партію і кілька світильників з результатами.

INSERT INTO products (name, insulation_min_mohm, earth_max_ohm) VALUES
    ('Світильник LED-40', 100, 0.1),
    ('Світильник LED-60', 150, 0.08);

-- відкрита партія моделі LED-40 (план 10)
INSERT INTO batches (product_id, planned_qty, status) VALUES
    (1, 10, 'open');

-- світильники в поточній партії
INSERT INTO units (barcode, barcode_driver, batch_id) VALUES
    ('SN001', 'DRV123', 1),
    ('SN002', 'DRV124', 1),
    ('SN003', 'DRV125', 1);

-- результати (приклад)
INSERT INTO results (unit_id, stage, value, data) VALUES
    (1, 1, NULL, NULL),
    (1, 2, 250.5, NULL),
    (1, 3, 0.05, NULL),
    (2, 1, NULL, NULL),
    (2, 4, NULL, NULL);
