---
title: "Qué flujo sigo al desarrollar con agentes"
date: 2026-10-26
tema: ia
resumen: "Cuatro pasos para trabajar con agentes de código sin perder velocidad ni la comprensión de lo que construyo, y las herramientas que me acompañan en cada uno."
---

Desarrollar un producto nunca ha sido sencillo. Con los agentes de código, modelos de lenguaje que ya no solo sugieren líneas sino que leen el repositorio, ejecutan comandos y trabajan solos durante horas, hemos multiplicado la productividad en una de las partes más costosas del proceso: convertir una idea en algo tangible. Pero son un arma de doble filo. La misma velocidad que nos dan puede hacernos perder la comprensión de lo que estamos construyendo.

El desarrollo está cambiando, y nosotros con él. En esta nota explico el flujo que sigo al programar con agentes para no perder ni velocidad ni conocimiento sobre mis propios desarrollos, y las herramientas que uso en cada paso.

## Las dos herramientas que me acompañan

Antes de los pasos, dos nombres que van a salir varias veces.

**[Superpowers](https://github.com/obra/superpowers)**, de Jesse Vincent ([obra](https://github.com/obra)), es un plugin para Claude Code que convierte un flujo de desarrollo disciplinado en *skills* que el agente aplica solo: antes de empezar una tarea comprueba si hay alguna que encaje y la sigue. Incluye, entre otras, `brainstorming` (preguntas y diseño antes de tocar código), `writing-plans` (dividir el trabajo en tareas pequeñas con ficheros y verificación), `subagent-driven-development` (un subagente nuevo por tarea, con revisión después de cada una), `test-driven-development`, `systematic-debugging` y `requesting-code-review`. Su autor cuenta la idea detrás en [este artículo](https://blog.fsck.com/2025/10/09/superpowers/). Se instala desde Claude Code con:

```text
/plugin install superpowers@claude-plugins-official
```

**[Context7](https://context7.com)**, de Upstash, es un servidor MCP que da al agente documentación actualizada y específica de la versión de cada librería, en lugar de lo que recuerde de su entrenamiento. Expone dos herramientas: `resolve-library-id`, que encuentra la librería, y `query-docs`, que trae la documentación relevante. Basta con añadir `use context7` al final de un prompt, o fijar la librería con `use library /supabase/supabase`. La instalación para Claude Code está en [su repositorio](https://github.com/upstash/context7); la vía rápida es `npx ctx7 setup --claude`, y el servidor remoto está en `https://mcp.context7.com/mcp`.

## 1. Identificar el problema

No es ningún secreto, lo sé. Identificar el problema parece un paso tan obvio que a menudo no le dedicamos la atención que merece. Pero una definición precisa es la que nos da una visión clara de lo que necesita el producto final, y todo lo que venga después dependerá de lo bien que la hayamos hecho.

Con agentes, además, esa definición es literalmente su punto de partida: un problema mal definido se convierte en un objetivo vago, y un agente con un objetivo vago produce mucho código en la dirección equivocada.

Por eso, antes de abrir un agente con acceso al código, abro una conversación larga con un modelo de lenguaje. Durante unas horas intento especializarme en el problema: aprendo conceptos que no conocía, me sumerjo en un entorno que me es ajeno y salgo con lo que buscaba, una definición clara. La skill `brainstorming` de Superpowers empuja en la misma dirección: el agente pregunta antes de construir y no avanza hasta que el diseño está acordado.

## 2. Plantear una propuesta

Con el problema bien definido, el siguiente paso es plantear una solución sólida, algo que lo resuelva de forma eficiente. Si antes usé el modelo para entender el problema, ahora lo uso para explorar soluciones.

Un modelo procesa mucha más información que nosotros y, con las herramientas adecuadas, puede hacer una exploración amplia de tecnologías y enfoques. Aquí es donde más rinde Context7: el mayor riesgo al comparar librerías con un modelo es que razone sobre una API de hace dos versiones, y con la documentación actual delante ese error desaparece casi por completo. A eso le sumo la búsqueda web.

En esta fase uso el modelo como recolector de información: quiero que me enseñe todo lo posible. De eso se encarga mi subagente «Dealer», que tira de Context7 y de la web y me trae las opciones sobre la mesa. Qué tecnologías uso y cómo las combino lo decido yo. Esa decisión acaba en un plan escrito, que es lo que `writing-plans` de Superpowers formaliza: tareas pequeñas, cada una con sus ficheros y su forma de comprobar que está bien hecha.

## 3. Delegar lo mecánico

En teoría, con un problema bien definido y una propuesta sólida, el desarrollo debería ser sencillo. Digo en teoría porque las variables son demasiadas. Los modelos mejoran a un ritmo que cuesta seguir y construir con ellos es cada vez más fácil, pero todavía no son infalibles.

En esta fase necesito tener el entorno listo. Cuento con una configuración que me permite fijar objetivos detallados y dejar al agente trabajando durante horas, y esos objetivos no salen de la nada: son la definición y el plan de los dos pasos anteriores. Superpowers es lo que sostiene esas horas de trabajo sin supervisión: aísla el trabajo en un *worktree* de git, reparte el plan entre subagentes que empiezan cada tarea con el contexto limpio, obliga a escribir el test antes que el código y no da una tarea por terminada sin verificarla.

Aquí me desentiendo por completo de la codificación pura. Nunca he sido especialmente bueno en ella y, aunque lo hubiera sido, estos modelos me habrían superado en eficiencia hace tiempo. No me cuesta admitir que hay cosas que hacen mucho mejor que yo.

## 4. Revisar y volver a empezar

Terminada la parte mecánica llega otra fase fundamental, la misma que hay quien empieza a delegar también en agentes que planifican, codifican y se revisan a sí mismos. Superpowers incluye esa revisión automática (`requesting-code-review` compara el resultado con el plan y clasifica los problemas por gravedad) y me parece útil como primer filtro. No como el último.

Aquí me imagino que vuelvo a empezar, solo que desde otro punto de vista. Antes tenía un problema que resolver; ahora tengo una solución que puede tener sus propios problemas para resolver el inicial. Vuelvo a mantener una ronda de preguntas con el modelo: reviso el código por encima y la arquitectura en profundidad.

He trabajado como Technical Lead y el instinto me lleva a comprobar que la arquitectura tiene orden y sentido. Más que revisar archivo por archivo, reviso el concepto: pruebo, entiendo, vuelvo a probar y miro los resultados. Si algo no me cuadra, vuelvo al primer paso.

## Para cerrar

En un entorno que nos empuja a desentendernos cada vez más de nuestros propios desarrollos, creo firmemente que el futuro de este oficio depende de las personas que se detienen a comprender lo que hacen desde el principio. Las herramientas ayudan, y mucho, pero sirven para delegar el trabajo, no el criterio. Delegar no es malo, ni lo será; lo hago constantemente en mi día a día. Lo que no delego es entender.

*Escrito por Ignacio Diago y desplegado por Claude Code.*
