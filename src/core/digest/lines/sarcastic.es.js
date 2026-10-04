/**
 * El Colega Sarcástico, español. Ironía seca sobre la situación, nunca sobre la persona
 * (docs/specs/2026-10-morning-partner.md). Written in Spanish, not translated. Neutral Spanish
 * with "tú", no gendered adjectives for the reader.
 * Each line: [subject and opening line, follow-up]. {count}, {weekday}; {item} only in the follow-up.
 * In overdue_few {count} is 1 or 2: write "Atrasados: {count}", never "{count} atrasados".
 * A line's id is its position: add new lines at the end of a list, never reorder or delete.
 */
module.exports = {
  all_clear: [
    ['¿Nada atrasado? ¿Quién eres y qué hiciste con tu versión de siempre?', 'Disfrútalo. Esto es lo nuevo.'],
    ['Cero atrasados. Enmarca este correo.', 'Igual llegaron cosas nuevas, obvio.'],
    ['Nada atrasado. Sospechoso, pero felicitaciones.', 'Echa un vistazo a lo que llegó.'],
    ['Todo al día. Me estoy quedando sin material.', 'Casi. Hay cosas nuevas abajo.'],
    ['Sin atrasos. Anótalo en el calendario.', 'Y de paso mira lo nuevo.'],
    ['Nada atrasado. Tu lista de pendientes no lo puede creer.', 'Bueno, casi. Lo nuevo está abajo.'],
    ['Todo al día un {weekday}. ¿Quién eres?', 'Lo nuevo está abajo. Sin presión.'],
    ['Nada atrasado. Que no se te suba a la cabeza.', 'Bueno, un poquito. Después mira lo nuevo.']
  ],
  due_today: [
    ['Algo vence hoy. Qué optimista de su parte asumir que te acordabas.', 'Ahora sí. Empieza por {item}.'],
    ['Hoy es la fecha. Hoy. O sea, hoy.', 'Solo para que estemos alineados.'],
    ['Un plazo entra a tu {weekday}…', 'No hay remate. Solo {item}.'],
    ['Vence hoy, un clásico del género.', 'Spoiler: termina contigo cerrándolo.'],
    ['El plazo de hoy te manda saludos.', 'Le encantaría saber de ti antes de las 5.'],
    ['Llamó tu yo del futuro: algo vence hoy.', 'Lo quiere listo. Empieza por {item}.'],
    ['Vence hoy. Imagina terminarlo antes del almuerzo.', 'Idea loca, lo sé.'],
    ['Algo vence hoy. No se hace solo. Lo comprobé.', 'Ábrelo a primera hora.']
  ],
  overdue_few: [
    ['Tienes algo atrasado. No se va a ningún lado. Tus plazos sí.', 'Spoiler: {item} sigue esperando.'],
    ['Atrasados: {count}. Te extrañan.', 'Sobre todo {item}.'],
    ['Un pendiente atrasado te manda saludos.', 'Ha sido muy paciente. Casi siempre.'],
    ['Atrasados: {count}. Ya se sienten como en casa.', 'Quizás hoy les muestres la puerta.'],
    ['Atrasado, pero con encanto.', 'El encanto se acaba. Empieza por {item}.'],
    ['Tu lista de atrasados es chica pero comprometida.', 'Diez minutos y es historia.'],
    ['Atrasados: {count}. No es una crisis. Todavía.', 'Mantengámoslo aburrido. Haz {item}.'],
    ['Giro inesperado: lo atrasado sigue atrasado.', 'La secuela donde lo terminas ya tiene fecha.']
  ],
  overdue_pile: [
    ['{count} atrasados. A estas alturas no son tareas, son familia.', 'Hora de independizarlos. Empieza por {item}.'],
    ['{count} atrasados. Ya armaron un grupo de WhatsApp.', 'Divide y vencerás. Empieza por {item}.'],
    ['{count} atrasados. Coleccionándolos todos, al parecer.', 'O terminas uno. También es opción.'],
    ['{count} atrasados. Ya es una colección.', 'Los coleccionistas a veces venden. Cierra uno.'],
    ['{count} atrasados. Formaron un sindicato.', 'Su única demanda: que los termines. Empieza por {item}.'],
    ['{count} atrasados. Estrategia audaz. Veamos cómo resulta.', 'O elige uno y termínalo. Tú decides.'],
    ['{count} atrasados. Hasta el calendario está preocupado.', 'Cierra uno antes del almuerzo y se calma.'],
    ['{count} atrasados un {weekday}. Se está volviendo tradición.', 'Las tradiciones se rompen. Empieza por uno.']
  ],
  // 6 o más: se acaban las bromas y ayuda a priorizar (spec, punto 5)
  overloaded: [
    ['{count} atrasados. Ni yo voy a bromear con esto.', 'Elige el que importa. Mueve el resto.'],
    ['{count} atrasados. Pausa a las bromas. Hora de priorizar.', 'Quédate con pocos. Reprograma o descarta los demás.'],
    ['{count} atrasados. ¿Honestamente? Algunos pueden irse.', 'Descarta los muertos, ponle fecha al resto, haz uno hoy.'],
    ['{count} atrasados. No todos son problema de hoy.', 'Uno que importe hoy. Fechas reales para el resto.'],
    ['{count} atrasados. Sarcasmo apagado. Plan encendido.', 'Diez minutos ordenando salvan la semana.'],
    ['{count} atrasados. Nadie hace todo eso en un día.', 'Elige uno. Eso ya es un buen día.'],
    ['{count} atrasados. Toca una limpieza honesta.', 'Puede que algunos ni sean tuyos. Revisa y muévelos.'],
    ['{count} atrasados. Achiquemos la lista.', 'Descarta, reprograma y después termina uno.']
  ],
  prep_only: [
    ['Reuniones hoy. Dato: la gente recuerda quién debe qué.', 'Los pendientes están abajo.'],
    ['Día de reuniones. Llegar sabiendo cosas. Imagínate.', 'Pendientes con estas personas, abajo.'],
    ['Tú tienes reuniones. Yo tengo notas. Combinemos.', 'Esto es lo pendiente con ellos.'],
    ['Reuniones hoy. Entra como si hubieras leído las notas.', 'Qué conveniente: están abajo.'],
    ['Reuniones este {weekday}. Llegar con todo claro se ve bien.', 'Los pendientes están abajo.'],
    ['Preparar reuniones, el superpoder menos glamoroso.', 'Dos minutos con la lista de abajo.'],
    ['Otro día de reuniones. Al menos llegarás con todo claro.', 'Aquí está quién debe qué.'],
    ['Reuniones hoy. Spoiler: alguien va a preguntar cómo va todo.', 'Ten la respuesta. Está abajo.']
  ]
};
