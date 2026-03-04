# WhsprNet

WhsprNet es una interfaz web para mensajería sobre LoRa que desarrollé originalmente como trabajo para la materia `Redes 2` de la facultad. El objetivo del proyecto fue crear un canal de chat entre nodos a través de LoRa, con una experiencia de uso clara desde el navegador y herramientas para configurar, monitorear y demostrar el funcionamiento del sistema.

Aunque nació en un contexto académico, lo tomé como una oportunidad para construir una pieza de portfolio técnico con valor real: una implementación que combina frontend, comunicación serial, lógica de protocolo e integración con hardware IoT.

## Objetivo del Proyecto

La idea central fue resolver un problema concreto: poder intercambiar mensajes entre dispositivos utilizando LoRa como medio de transporte, y al mismo tiempo ofrecer una interfaz práctica para operar ese canal de comunicación.

En términos funcionales, el proyecto busca:

- Crear un canal de chat sobre LoRa entre dispositivos.
- Enviar y recibir mensajes desde una interfaz web.
- Configurar parámetros de radio sin reflashear el firmware.
- Mostrar el estado de entrega, reintentos y fallos de transmisión.
- Facilitar demostraciones y depuración del sistema en tiempo real.

## Origen y Enfoque Personal

Este proyecto surgió como parte de `Redes 2`, pero el enfoque no fue solo cumplir con una consigna. La intención fue llevarlo a un nivel que también funcionara como demostración técnica de criterio de ingeniería:

- Diseño de una interfaz usable para interactuar con hardware.
- Comunicación directa entre navegador y dispositivo por puerto serie.
- Lectura y procesamiento de eventos del firmware en tiempo real.
- Exposición visual del estado del sistema para pruebas y demos.
- Integración entre web, redes e IoT en un mismo flujo.

Por eso, `WhsprNet` representa tanto el contexto académico en el que nació como una forma concreta de mostrar cómo encaro un proyecto técnico de punta a punta.

## Qué Demuestra

`WhsprNet` no es solamente una pantalla estática. Está pensado para mostrarse funcionando:

- Conexión desde el navegador a un dispositivo ESP por USB.
- Uso de Web Serial para abrir el puerto y manejar el intercambio de datos.
- Envío de mensajes hacia el firmware para transmitirlos por LoRa.
- Recepción de mensajes entrantes y actualización del chat en tiempo real.
- Visualización del estado de cada mensaje: pendiente, entregado o fallido.
- Consola integrada para observar respuestas del dispositivo y eventos del sistema.

Eso lo vuelve una pieza útil para portfolio porque muestra una integración real entre software de interfaz, lógica de comunicación y hardware.

## Arquitectura Técnica

### Stack

- Next.js 16
- React 19
- TypeScript
- ESLint
- Web Serial API

### Contexto de Redes e IoT

La aplicación está pensada para trabajar con un dispositivo basado en ESP que expone por serial un firmware con soporte para LoRa. Desde el navegador, la app se conecta al puerto serie, envía comandos de control y procesa las respuestas del dispositivo para reflejar el estado del sistema en la UI.

El caso de uso principal es operar un nodo capaz de:

- Configurarse dinámicamente.
- Transmitir mensajes por LoRa.
- Reportar estados de entrega y reintentos.
- Exponer información útil para debug y demostración.

### Protocolo Utilizado por la Interfaz

La UI asume un protocolo textual simple, pensado para iterar rápido y facilitar la observabilidad.

Comandos enviados por la app:

- `/cfg get`
- `/cfg set alias=...;freq=...;sf=...`
- `/sec get`
- `/sec set mode=...;key=...`

Líneas que la app interpreta desde el dispositivo:

- `CFG ...`
- `SEC ...`
- `READY ...`
- `RX: alias: mensaje`
- `YOU: OUT #id`
- `YOU: TRY #id i/N`
- `YOU: ✓ Entregado #id`
- `YOU: FAIL #id`

## Cómo Funciona la Aplicación

La implementación actual concentra la lógica principal en un componente cliente para que el flujo completo sea fácil de seguir durante una revisión técnica o una demo.

El flujo general es:

- El navegador solicita acceso a un puerto serie mediante Web Serial.
- Se crean flujos de codificación y decodificación para intercambiar texto con el dispositivo.
- Las líneas recibidas se parsean y actualizan la configuración, la consola o el estado del chat.
- Los mensajes escritos desde la interfaz se envían al firmware por el mismo canal serial.
- El estado visual de cada mensaje cambia a medida que el firmware reporta salida, reintentos, entrega o fallo.

Esta estructura prioriza claridad, trazabilidad del estado y facilidad de demostración.

## Funcionalidades Principales

- Conexión y desconexión del dispositivo desde el navegador.
- Chat en tiempo real sobre el canal LoRa.
- Consola de sistema para observar eventos y respuestas del firmware.
- Configuración de parámetros de radio.
- Persistencia del tema visual.
- Panel de encriptación simple para firmwares que soportan `/sec`.

Parámetros configurables desde la interfaz:

- Alias
- Frecuencia
- Spreading Factor
- Bandwidth
- Coding Rate
- Preamble
- Sync Word
- CRC
- Cantidad de reintentos
- Intervalo entre reintentos

## Ejecución Local

```bash
npm install
npm run dev
```

Luego abrir `http://localhost:3000`.

## Requisitos para la Demo

Para usar la experiencia completa hace falta:

- Un navegador basado en Chromium con soporte para Web Serial.
- Un dispositivo ESP conectado por USB.
- Un firmware compatible con el protocolo esperado por la interfaz.
- Un entorno de prueba donde tenga sentido transmitir mensajes por LoRa entre nodos.

Sin hardware compatible, la interfaz se puede revisar y ejecutar, pero el flujo principal depende del dispositivo conectado.

## Decisiones Técnicas Relevantes

- La comunicación con el dispositivo se resuelve desde el navegador para eliminar fricción durante las demostraciones.
- El protocolo textual simplifica tanto el debug como la iteración sobre el firmware.
- La consola integrada mejora la observabilidad sin depender de herramientas externas.
- La interfaz muestra explícitamente reintentos, entregas y fallos para hacer visible el comportamiento de la red.
- El modo de encriptación XOR incluido está pensado para pruebas, no para seguridad de producción.

## Limitaciones Actuales

- Todavía no hay una suite de tests automatizados.
- La funcionalidad depende de soporte de Web Serial en el navegador.
- El proyecto depende del comportamiento esperado del firmware.
- El modo de encriptación disponible es básico y orientado a demostración.

## Próximos Pasos Posibles

- Separar la lógica de transporte serial, parsing y UI en módulos independientes.
- Agregar tests para el parseo de mensajes y estados de entrega.
- Incorporar una estrategia de cifrado más robusta respaldada por el firmware.
- Añadir capturas o una demo grabada del sistema en funcionamiento.
- Extender el protocolo para soportar más telemetría o gestión de nodos.

## Resumen para Portfolio

`WhsprNet` nació como un proyecto de `Redes 2`, pero evolucionó en una demostración técnica sólida de integración entre frontend, comunicación serial, redes inalámbricas e IoT. Más que un trabajo de facultad, es una muestra concreta de cómo abordo un problema real, diseño una interfaz útil y conecto software con hardware para lograr una experiencia funcional y demostrable.
