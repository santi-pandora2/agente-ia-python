# Skill: Normalización y Procesamiento de Pedidos de WhatsApp a Excel

## 📋 Descripción General
Esta skill permite procesar, limpiar y normalizar un conjunto de datos desestructurados provenientes de conversaciones de WhatsApp (formato JSON)[cite: 1] hacia un formato tabular relacional estructurado en Excel. Su objetivo es evitar la duplicidad de registros, asegurar la integridad de las órdenes, aplicar formato de mayúscula inicial y cumplir con las Tres Formas Normales (1NF, 2NF, 3NF).

---

## 🔍 1. Reglas de Limpieza y Transformación Previa

### A. Mayúscula Inicial (`INITCAP`)
* Todos los campos de texto descriptivo (Nombres de clientes, Ciudades, Barrios, Nombres de productos y Estados) deben transformarse para que la primera letra de cada palabra esté en mayúscula y el resto en minúscula.
  * *Ejemplo:* `ana gómez` ➡️ `Ana Gómez`[cite: 1]
  * *Ejemplo:* `barrio palermo` ➡️ `Barrio Palermo`[cite: 1]

### B. Validación de Órdenes Duplicadas
* **Identificador Único de Orden:** Se extrae el código del ticket/punto de entrega mencionado en el chat (ej. `HOG-0001`)[cite: 1].
* **Control de Duplicidad:** El sistema debe verificar la lista de órdenes existentes. Si un `conversation_id` o `ticket_id` ya fue registrado, la fila se descarta o se marca como duplicada para evitar que el mismo pedido aparezca dos veces en el Excel final.

---

## 📐 2. Estructura de Normalización de Datos

Para garantizar la consistencia y evitar redundancias, el modelo de datos se divide en tablas normalizadas:

### ⚡ Primera Forma Normal (1NF) - Valores Atómicos
* **Objetivo:** Eliminar grupos repetitivos y asegurar que cada celda contenga un único valor. Los mensajes de WhatsApp donde los clientes solicitan múltiples productos en una sola frase se descomponen en líneas de detalle independientes.
* **Estructura Tabular Provisional (1NF):**
  * `ID_Conversacion`, `Telefono`, `Nombre_Cliente`, `Ciudad`, `Barrio`, `Fecha_Hora`, `Producto_Solicitado`, `Cantidad`, `Subtotal_Item`, `Total_Orden`, `Estado_Pedido`.

### 🔄 Segunda Forma Normal (2NF) - Dependencia Funcional Completa
* **Objetivo:** Estar en 1NF y eliminar dependencias parciales separando los datos en entidades independientes mediante claves primarias.
* **Tablas Resultantes en 2NF:**
  1. **Tabla `Clientes`:**
     * `ID_Cliente` (PK - Llave Primaria)
     * `Telefono`
     * `Nombre_Cliente`
  2. **Tabla `Pedidos`:**
     * `ID_Pedido` (PK, ej. `HOG-0001` con validación de unicidad)[cite: 1]
     * `ID_Cliente` (FK - Llave Foránea)
     * `Ciudad`
     * `Barrio`
     * `Fecha`
     * `Total_Pedido`
     * `Estado`
  3. **Tabla `Detalle_Pedido`:**
     * `ID_Detalle` (PK)
     * `ID_Pedido` (FK)
     * `Nombre_Producto`
     * `Cantidad`
     * `Precio_Unitario`

### 🔗 Tercera Forma Normal (3NF) - Ausencia de Dependencias Transitivas
* **Objetivo:** Estar en 2NF y eliminar cualquier dependencia entre atributos que no sean clave. Las ubicaciones y los costos de envío asociados se aíslan para evitar redundancia de datos geográficos.
* **Tablas Finales (3NF) para el Excel:**
  * **`Dim_Clientes`**: `ID_Cliente`, `Telefono`, `Nombre_Cliente` (Mayúscula inicial aplicada).
  * **`Dim_Ubicaciones`**: `ID_Ubicacion`, `Ciudad`, `Barrio`, `Costo_Domicilio_Base`.
  * **`Fact_Pedidos`**: `ID_Pedido` (Validado contra duplicados), `ID_Cliente`, `ID_Ubicacion`, `Fecha_Hora`, `Metodo_Pago`, `Total`.
  * **`Fact_Detalle_Pedidos`**: `ID_Linea`, `ID_Pedido`, `SKU_Producto`, `Descripcion_Producto`, `Cantidad`.

---

## ⚙️ 3. Algoritmo de Validación en la Generación del Excel

1. **Ingesta:** Cargar el archivo JSON de origen[cite: 1].
2. **Filtrado de Mensajes Válidos:** Procesar únicamente los mensajes donde se confirma la transacción (ej. "Pedido confirmado" o equivalentes en el flujo del chat)[cite: 1].
3. **Validación de Unicidad:** 
   ```python
   if id_pedido in set_ordenes_procesadas:
       marcar_como_duplicado_y_descartar()
   else:
       set_ordenes_procesadas.add(id_pedido)