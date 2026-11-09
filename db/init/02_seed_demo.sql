-- Демо-дані для першого запуску. Видали цей файл перед промисловою експлуатацією.

INSERT INTO product_types (name) VALUES ('Світильник'), ('Щит');

INSERT INTO products (name, description, type_id, article, characteristics) VALUES
('Світильник LED-40', 'Демонстраційна модель', 1, 'LED-40',
 '{"limits": {"dielectric": {"min": 100, "range_min": 0, "range_max": 10000}}}');

INSERT INTO workstations (number, name, template, template_params, result_key) VALUES
(1, 'Опір ізоляції', 'measurement', '{"label": "Опір ізоляції", "unit": "МОм", "product_id": 1}', 'dielectric'),
(2, 'Фотофіксація',  'photo',       '{}', NULL),
(3, 'Фінальний тест', 'final-test', '{}', 'final');

INSERT INTO settings (key, value) VALUES ('daily_plan', '100');
