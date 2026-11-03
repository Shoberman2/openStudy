// Demo mode content (spec 15.5): hand-written study packs that run with no AI key. These are real
// lessons, and every question goes through the same validator and pipeline as a model's.
import type { Block, FlashcardsBlock, Question } from "./blocks";

export type Pack = {
  id: string;
  title: string;
  concept: string;
  match: RegExp;
  intro: string;
  blocks: Block[];
  cards: FlashcardsBlock["cards"];
  questions: Question[];
};

type Opt = [text: string, explanation: string];

/** Options in order a to d, the first argument names the right one. */
function q(id: string, concept: string, difficulty: number, skill: Question["skill"], stem: string, right: "a" | "b" | "c" | "d", opts: [Opt, Opt, Opt, Opt]): Question {
  const ids = ["a", "b", "c", "d"] as const;
  return {
    id,
    concept,
    difficulty,
    skill,
    stem,
    options: opts.map(([text, explanation], i) => ({ id: ids[i], text, explanation, correct: ids[i] === right })),
  };
}

const QUADRATICS = "Quadratic Functions";
const DERIVATIVES = "Derivatives";
const INTEREST = "Compound Interest";
const PHOTO = "Photosynthesis";
const MARKET = "Supply And Demand";

export const PACKS: Pack[] = [
  {
    id: "quadratics",
    title: QUADRATICS,
    concept: QUADRATICS,
    match: /quadratic|parabola|vertex|discriminant|x\^2|x²/i,
    intro:
      "A quadratic is any function with an $x^2$ term as its highest power. Its graph is a parabola, and three numbers control everything about it. **$a$** sets how steep it is and which way it opens, **$c$** is where it crosses the y-axis, and **$b$** slides the vertex along a curved path.",
    blocks: [
      { type: "formula", latex: "\\begin{gathered} f(x) = ax^2 + bx + c \\\\ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} \\end{gathered}", caption: "Standard form and the quadratic formula" },
      {
        type: "plot",
        title: "Change A Parabola",
        variable: "x",
        domain: [-8, 8],
        range: [-12, 12],
        xLabel: "x",
        yLabel: "f(x)",
        curves: [{ label: "f(x)", expr: "a*x^2 + b*x + c" }],
        sliders: [
          { name: "a", label: "a, steepness", min: -3, max: 3, step: 0.1, value: 1 },
          { name: "b", label: "b, slide", min: -6, max: 6, step: 0.5, value: -2 },
          { name: "c", label: "c, y-intercept", min: -8, max: 8, step: 0.5, value: -3 },
        ],
        hint: "Set a to 0 and watch the curve become a line. That is why a cannot be 0 in a quadratic.",
      },
      {
        type: "diagram",
        title: "What The Discriminant Tells You",
        nodes: [
          { id: "d", label: "b² - 4ac", detail: "The part under the square root in the quadratic formula." },
          { id: "pos", label: "Positive", detail: "The square root is a real number, and plus or minus gives two different answers." },
          { id: "zero", label: "Zero", detail: "Plus or minus zero is the same number, so both answers land together." },
          { id: "neg", label: "Negative", detail: "No real number squares to a negative, so there are no real solutions." },
          { id: "two", label: "Crosses the x-axis twice" },
          { id: "one", label: "Touches at the vertex" },
          { id: "none", label: "Never reaches the x-axis" },
        ],
        edges: [
          { from: "d", to: "pos" },
          { from: "d", to: "zero" },
          { from: "d", to: "neg" },
          { from: "pos", to: "two" },
          { from: "zero", to: "one" },
          { from: "neg", to: "none" },
        ],
      },
      {
        type: "steps",
        title: "Worked Solution",
        problem: "Solve $x^2 - 5x + 6 = 0$.",
        steps: [
          { ask: "What are a, b and c? Find the discriminant.", work: "$a=1,\\ b=-5,\\ c=6$, so $b^2-4ac = 25 - 24 = 1$", why: "The discriminant is positive, so expect two real solutions before doing any more work.", check: "1" },
          { ask: "Find the square root of the discriminant and write the formula.", work: "$x = \\dfrac{5 \\pm \\sqrt{1}}{2} = \\dfrac{5 \\pm 1}{2}$", why: "The sign flips on b because the formula starts with $-b$, and $-(-5) = 5$." },
          { ask: "What is the larger solution?", work: "$x = \\dfrac{5 + 1}{2} = 3$", why: "Taking the plus sign gives the larger root.", check: "3" },
          { ask: "What is the smaller solution?", work: "$x = \\dfrac{5 - 1}{2} = 2$", why: "Check it: $2^2 - 5(2) + 6 = 0$.", check: "2" },
        ],
        answer: "$x = 2$ or $x = 3$",
      },
      { type: "quiz_request", topic: QUADRATICS, concept: QUADRATICS, count: 3 },
    ],
    cards: [
      { front: "What does the sign of $a$ tell you?", back: "Positive opens up and the vertex is a minimum. Negative opens down and the vertex is a maximum." },
      { front: "Where is the vertex of $ax^2+bx+c$ on the x-axis?", back: "At $x = -\\dfrac{b}{2a}$, halfway between the two roots." },
      { front: "What does $c$ tell you on the graph?", back: "It is the y-intercept, since $f(0) = c$." },
      { front: "When does a quadratic have exactly one real root?", back: "When $b^2 - 4ac = 0$. The vertex sits right on the x-axis." },
      { front: "Why can a quadratic never have three real roots?", back: "The parabola turns only once, so it can cross a horizontal line at most twice." },
    ],
    questions: [
      q("quad-1", QUADRATICS, 1, "apply", "For $f(x) = 2x^2 - 3x + 5$, where does the graph cross the y-axis?", "c", [
        ["At $y = 2$", "2 is $a$, which sets steepness. It has no direct link to where the graph crosses the y-axis."],
        ["At $y = -3$", "-3 is $b$. A common slip is reading the middle number as the intercept, but $bx$ vanishes when $x = 0$."],
        ["At $y = 5$", "Right. Put $x = 0$ and the first two terms vanish, which leaves $f(0) = 5$."],
        ["At $y = 0$", "That confuses a y-intercept with a root. The y-intercept is the output at $x = 0$, not where the output is 0."],
      ]),
      q("quad-2", QUADRATICS, 2, "apply", "A parabola has roots at $x = 1$ and $x = 7$. Where is its line of symmetry?", "b", [
        ["$x = 3$", "This halves the gap of 6 but forgets to start from 1. Halfway means the average of the roots."],
        ["$x = 4$", "Right. The two roots sit the same distance from the axis, so it is their average: $(1 + 7) / 2 = 4$."],
        ["$x = 6$", "This is the distance between the roots, not the point between them."],
        ["$x = 8$", "This adds the roots without halving them. The sum is only part of the average."],
      ]),
      q("quad-3", QUADRATICS, 3, "predict", "Keep $a$ and $b$ fixed for $f(x) = x^2 - 4x + c$. As $c$ rises from 0 to 10, what happens to the real roots?", "d", [
        ["They stay the same", "Roots depend on $c$ too. Raising the whole curve changes where it meets the x-axis."],
        ["They move further apart", "That is what lowering $c$ does. Pushing the curve down widens the cut across the x-axis."],
        ["They both shift to the right", "This treats $c$ as a sideways shift, but $c$ moves the curve straight up and down."],
        ["They merge, then disappear", "Right. The discriminant $16 - 4c$ shrinks to 0 at $c = 4$, then turns negative as the curve lifts off the axis."],
      ]),
      q("quad-4", QUADRATICS, 4, "explain", "A ball's height is $h(t) = -5t^2 + 20t$. Why does the ball reach its peak at $t = 2$, well before the larger root?", "a", [
        ["It lies midway between the two roots", "Right. The roots are $t = 0$ and $t = 4$, launch and landing, and a parabola is symmetric, so the vertex is at their midpoint."],
        ["The largest root gives the largest height", "A root is where height equals 0, so at $t = 4$ the ball is on the ground, not at its peak."],
        ["The peak occurs where $h(t)$ equals 20", "20 is the coefficient of $t$. It is not the height at the peak, which works out as $h(2) = 20$ only by coincidence here."],
        ["Time must be halved for falling objects", "Halving is not a rule about falling. The midpoint appears here because of the symmetry of this curve."],
      ]),
      q("quad-5", QUADRATICS, 5, "diagnose", "A student divides both sides of $x^2 = 3x$ by $x$ and concludes $x = 3$ is the only solution. What went wrong?", "b", [
        ["They should have subtracted 3 instead", "Subtracting 3 does not simplify this equation. The operations they used were not the wrong choice of number."],
        ["That step assumed $x$ is never zero, losing $x = 0$", "Right. Dividing by $x$ assumes $x \\neq 0$. Factor instead: $x(x - 3) = 0$ gives $x = 0$ or $x = 3$."],
        ["The value $x = 3$ does not satisfy it", "It does: $3^2 = 3 \\cdot 3$. The answer they found is fine. The problem is the one they lost."],
        ["Quadratics always need the full formula", "The formula is one tool, not a requirement. Factoring works here, and it would have kept both solutions."],
      ]),
    ],
  },
  {
    id: "derivatives",
    title: DERIVATIVES,
    concept: DERIVATIVES,
    match: /derivative|differentiat|slope of|tangent|power rule|rate of change|calculus/i,
    intro:
      "A derivative answers one question: **how fast is the output changing right here?** Take two points on a curve, draw the line through them, and slide them together. The slope that line settles on is the derivative at that point.",
    blocks: [
      { type: "formula", latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}", caption: "The slope between two points as they slide together" },
      {
        type: "plot",
        title: "Slide The Tangent Line",
        variable: "x",
        domain: [-4, 4],
        range: [-6, 10],
        curves: [
          { label: "f(x) = x²", expr: "x^2" },
          { label: "Tangent at p", expr: "2*p*(x - p) + p^2" },
        ],
        sliders: [{ name: "p", label: "p, point of contact", min: -3, max: 3, step: 0.1, value: 1 }],
        hint: "At p = 0 the tangent is flat. That is the slope changing sign, and it is what the minimum looks like.",
      },
      {
        type: "steps",
        title: "Worked Solution",
        problem: "Find the slope of $f(x) = 3x^2 - 4x$ at $x = 2$.",
        steps: [
          { ask: "Use the power rule on $3x^2$. What do you get?", work: "$\\dfrac{d}{dx}3x^2 = 6x$", why: "Bring the 2 down and reduce the power by one: $3 \\cdot 2 \\cdot x^{1}$." },
          { ask: "What is the derivative of $-4x$?", work: "$\\dfrac{d}{dx}(-4x) = -4$", why: "A straight line has the same slope everywhere, and that slope is its coefficient.", check: "-4" },
          { ask: "Now put $x = 2$ into $f'(x) = 6x - 4$.", work: "$f'(2) = 12 - 4 = 8$", why: "Substitute last. Putting 2 in before differentiating turns the function into a constant, whose derivative is 0.", check: "8" },
        ],
        answer: "The slope at $x = 2$ is $8$.",
      },
      { type: "quiz_request", topic: DERIVATIVES, concept: DERIVATIVES, count: 3 },
    ],
    cards: [
      { front: "What does $f'(a) = 0$ tell you about the graph at $a$?", back: "The tangent is flat. It may be a peak, a valley or a pause, so check the slope either side." },
      { front: "State the power rule.", back: "$\\dfrac{d}{dx}x^n = nx^{n-1}$" },
      { front: "What is the derivative of a constant, and why?", back: "0. A constant never changes, so its rate of change is zero." },
      { front: "If position is $s(t)$, what is $s'(t)$?", back: "Velocity, the rate of change of position." },
    ],
    questions: [
      q("deriv-1", DERIVATIVES, 1, "apply", "If $f(x) = x^3$, what is $f'(2)$?", "d", [
        ["$6$", "This keeps the old power: $3 \\cdot 2$. The power rule also lowers the exponent, so it should be $3x^2$."],
        ["$8$", "This is $f(2)$, the height of the curve. The derivative asks for its slope instead."],
        ["$4$", "This drops the coefficient: $x^2$ at 2. The rule brings the 3 down as a multiplier."],
        ["$12$", "Right. $f'(x) = 3x^2$, so $f'(2) = 3 \\cdot 4 = 12$."],
      ]),
      q("deriv-2", DERIVATIVES, 2, "explain", "On a graph of $f$, the slope at a point is negative. What is true at that point?", "a", [
        ["The output falls as $x$ increases", "Right. A negative derivative means the function is decreasing there, wherever the curve happens to sit."],
        ["The value of $f(x)$ is negative", "This mixes up height and slope. A curve high above the axis can still be heading down."],
        ["The curve lies under the x-axis", "This is the same mix-up in picture form. Position on the graph says nothing about direction."],
        ["The curve has a sharp corner", "A corner means no derivative exists at all, and here a slope exists."],
      ]),
      q("deriv-3", DERIVATIVES, 3, "apply", "A car's position is $s(t) = t^2 + 3t$ metres. How fast is it going at $t = 4$ seconds?", "b", [
        ["$28$ m/s", "28 is $s(4)$, the position in metres. Speed is the rate at which that changes."],
        ["$11$ m/s", "Right. $s'(t) = 2t + 3$, so at $t = 4$ the speed is $8 + 3 = 11$ m/s."],
        ["$7$ m/s", "This is average speed, $s(4)/4$. The question asks for the instantaneous speed."],
        ["$5$ m/s", "This is $s'(1)$. The substitution needs to use $t = 4$."],
      ]),
      q("deriv-4", DERIVATIVES, 4, "predict", "$f'(x)$ changes from positive to negative at $x = 3$. What does $f$ have there?", "c", [
        ["A local minimum", "That is the opposite pattern. At a minimum the slope goes from negative to positive."],
        ["A root at $x = 3$", "Roots of $f'$ are not roots of $f$. The function can have any height at this point."],
        ["A local maximum", "Right. The function rises up to $x = 3$ and falls after it, which makes it a peak."],
        ["A point of inflection", "An inflection is where the slope's trend changes, not where its sign flips like this."],
      ]),
      q("deriv-5", DERIVATIVES, 5, "diagnose", "A student says: $f'(0) = 0$ for $f(x) = x^3$, so $x = 0$ is a maximum or a minimum. What is the flaw?", "d", [
        ["The derivative at 0 is really 1", "The derivative is $3x^2$, which is 0 at $x = 0$. Their arithmetic is fine."],
        ["Only quadratics have a flat tangent", "Any smooth curve can have a flat tangent. The degree is not what matters."],
        ["Maxima appear only at the endpoints", "Local peaks appear inside an interval all the time, as any parabola shows."],
        ["A zero slope alone proves no turning", "Right. $3x^2$ is positive on both sides of 0, so $x^3$ keeps rising through a flat spot and never turns."],
      ]),
    ],
  },
  {
    id: "interest",
    title: INTEREST,
    concept: INTEREST,
    match: /compound|interest|invest|savings|exponential growth|apr/i,
    intro:
      "Compound interest pays interest on past interest. Early on it looks like a straight line. Later the curve bends upward, because each year's growth is calculated on a bigger balance. **Time matters more than almost anything else in the formula.**",
    blocks: [
      { type: "formula", latex: "A = P\\left(1 + \\frac{r}{n}\\right)^{nt}", caption: "P is the principal, r the yearly rate, n the compounds per year, t the years" },
      {
        type: "plot",
        title: "Grow A Balance",
        variable: "t",
        domain: [0, 40],
        xLabel: "Years",
        yLabel: "Balance in dollars",
        curves: [
          { label: "Compound", expr: "P*(1 + r/100)^t" },
          { label: "Simple", expr: "P*(1 + r/100*t)" },
        ],
        sliders: [
          { name: "P", label: "Starting amount", min: 100, max: 10000, step: 100, value: 1000 },
          { name: "r", label: "Yearly rate, percent", min: 0, max: 15, step: 0.5, value: 7 },
        ],
        hint: "Double the rate and compare the end of the curve. It more than doubles the gain.",
      },
      {
        type: "steps",
        title: "Worked Solution",
        problem: "You invest $2,000 at 6% a year, compounded once a year. What do you have after 2 years?",
        steps: [
          { ask: "What is the balance after year one?", work: "$2000 \\times 1.06 = 2120$", why: "Growing by 6% is the same as multiplying by 1.06.", check: "2120" },
          { ask: "What is the balance after year two?", work: "$2120 \\times 1.06 = 2247.20$", why: "Year two's interest is worked out on 2,120, not on the original 2,000. That is the compounding.", check: "2247.2" },
        ],
        answer: "$2,247.20, which is $7.20 more than simple interest would pay.",
      },
      { type: "quiz_request", topic: INTEREST, concept: INTEREST, count: 3 },
    ],
    cards: [
      { front: "What is the rule of 72?", back: "Divide 72 by the yearly percent rate to estimate how many years it takes to double." },
      { front: "Why does compounding more often earn more?", back: "Interest starts earning interest sooner, though the gain shrinks as compounding gets more frequent." },
      { front: "Simple versus compound growth on a graph?", back: "Simple interest is a straight line. Compound interest is a curve that keeps steepening." },
    ],
    questions: [
      q("int-1", INTEREST, 1, "apply", "You put $100 in at 10% a year, compounded yearly. What is the balance after 2 years?", "b", [
        ["$120", "This is simple interest, which adds $10 each year. It ignores the interest earned on the first year's interest."],
        ["$121", "Right. $100 \\times 1.1 \\times 1.1 = 121$. The extra dollar is interest on the first $10."],
        ["$110", "This is the balance after only 1 year."],
        ["$200", "This assumes the money doubles, which at 10% would take about 7 years."],
      ]),
      q("int-2", INTEREST, 2, "compare", "Two accounts pay 5% a year on the same deposit. One compounds monthly and one yearly. How do they compare after 10 years?", "c", [
        ["They end up exactly equal", "The rate is the same, but monthly interest starts earning interest sooner."],
        ["Yearly compounding ends higher", "This reverses the effect. Waiting longer to add interest means less time for it to earn."],
        ["Monthly compounding ends slightly higher", "Right. Interest gets added sooner, but at 5% the difference after 10 years is only about 1 percent of the balance."],
        ["Monthly compounding ends twelve times higher", "The yearly rate is split into 12 pieces, so it is not multiplied by 12."],
      ]),
      q("int-3", INTEREST, 3, "predict", "An investment doubles every 9 years. Starting with $1,000, what is it worth after 27 years?", "d", [
        ["$3,000", "This doubles once and adds, as if growth were linear. It should double three times, on the balance each time."],
        ["$6,000", "This multiplies 2 by 3 where it should raise 2 to the power of 3."],
        ["$4,000", "This counts two doublings. 27 years holds three periods of 9."],
        ["$8,000", "Right. Three doublings give $1000 \\times 2^3 = 8000$."],
      ]),
      q("int-4", INTEREST, 4, "compare", "Ana invests $1,000 at age 20 and stops. Ben invests $1,000 at age 40 and stops. Both earn 7% until 60. About how do their balances compare?", "a", [
        ["Ana ends with roughly 4 times as much", "Right. 20 extra years at 7% means about 2 doublings, so $1.07^{20} \\approx 3.9$."],
        ["Ana ends with exactly 2 times as much", "This reasons that 40 years is twice 20. Growth multiplies with time, it does not add."],
        ["They end with about the same amount", "Equal deposits do not mean equal outcomes. Ana's money compounds for twice as long."],
        ["Ben ends ahead of her by a little", "Ben invested later with the same rate and amount, so he cannot catch up."],
      ]),
      q("int-5", INTEREST, 5, "diagnose", "A fund grows 50% one year, then falls 50% the next. An advert says the average return is 0%. What does a $100 investor really have?", "b", [
        ["$100, since the changes cancel", "The percentages are of different balances. The 50% loss applies to a larger amount."],
        ["$75, since losses apply to the bigger sum", "Right. $100 \\to 150 \\to 75$. Percent changes multiply, $1.5 \\times 0.5 = 0.75$, so the plain average misleads."],
        ["$125, since the gain came first", "Order does not matter here, because multiplication gives 0.75 either way."],
        ["$50, since the fall wipes out the gain", "This forgets that the fall starts from $150, so half of it leaves $75."],
      ]),
    ],
  },
  {
    id: "photosynthesis",
    title: PHOTO,
    concept: PHOTO,
    match: /photosynth|chloroplast|chlorophyll|calvin|light reaction|plants? (make|get|produce)/i,
    intro:
      "Photosynthesis is how plants store sunlight as sugar. It runs in two linked stages. The **light reactions** capture energy and split water, which releases oxygen. The **Calvin cycle** spends that energy to build sugar from carbon dioxide. Most of a tree's mass comes from the air, not the soil.",
    blocks: [
      { type: "formula", latex: "6\\,CO_2 + 6\\,H_2O \\xrightarrow{\\text{light}} C_6H_{12}O_6 + 6\\,O_2", caption: "The overall balance, not one single reaction" },
      {
        type: "diagram",
        title: "How The Two Stages Connect",
        nodes: [
          { id: "sun", label: "Sunlight" },
          { id: "water", label: "Water", detail: "Split in the light reactions. Its oxygen is the oxygen a plant releases." },
          { id: "co2", label: "Carbon dioxide", detail: "Enters through pores called stomata and supplies the carbon in sugar." },
          { id: "light", label: "Light reactions", detail: "In the thylakoid membranes. Convert light energy into ATP and NADPH." },
          { id: "o2", label: "Oxygen" },
          { id: "atp", label: "ATP and NADPH", detail: "Short-term energy carriers that link the two stages." },
          { id: "calvin", label: "Calvin cycle", detail: "In the stroma. Uses ATP and NADPH to fix carbon into sugar. Stops soon after the light does." },
          { id: "sugar", label: "Glucose" },
        ],
        edges: [
          { from: "sun", to: "light" },
          { from: "water", to: "light" },
          { from: "light", to: "o2", label: "releases" },
          { from: "light", to: "atp", label: "makes" },
          { from: "atp", to: "calvin", label: "powers" },
          { from: "co2", to: "calvin" },
          { from: "calvin", to: "sugar", label: "builds" },
        ],
      },
      {
        type: "plot",
        title: "Rate Against Light Intensity",
        variable: "L",
        domain: [0, 100],
        xLabel: "Light intensity",
        yLabel: "Rate",
        curves: [{ label: "Rate", expr: "cap*L/(k + L)" }],
        sliders: [
          { name: "cap", label: "Limit set by CO2 and temperature", min: 2, max: 20, step: 1, value: 12 },
          { name: "k", label: "Light needed to reach half the limit", min: 2, max: 50, step: 1, value: 15 },
        ],
        hint: "The curve flattens because something other than light becomes the limit. This is a teaching model of the shape, not measured data.",
      },
      { type: "quiz_request", topic: PHOTO, concept: PHOTO, count: 3 },
    ],
    cards: [
      { front: "Where does the oxygen released in photosynthesis come from?", back: "From water, split in the light reactions. Not from carbon dioxide." },
      { front: "Where do the two stages happen?", back: "Light reactions in the thylakoid membranes, the Calvin cycle in the stroma." },
      { front: "What links the two stages?", back: "ATP and NADPH from the light reactions power the Calvin cycle." },
      { front: "Why do leaves look green?", back: "Chlorophyll absorbs red and blue light best and reflects more of the green." },
    ],
    questions: [
      q("photo-1", PHOTO, 1, "explain", "Where does most of the dry mass of a growing tree come from?", "c", [
        ["Minerals in the soil", "A classic misconception. Soil provides small amounts of minerals, and pots of soil barely lose weight as a tree grows."],
        ["Water taken in by roots", "Water supplies hydrogen and is vital, but it is not where most dry mass comes from, and dry mass excludes water held in tissue."],
        ["Carbon dioxide from the air", "Right. Carbon from CO2 is built into sugar and then into cellulose, which makes up most of the dry mass."],
        ["Energy absorbed from sunlight", "Light provides energy, not matter. It drives the building but does not become the wood."],
      ]),
      q("photo-2", PHOTO, 2, "explain", "A plant is grown with water containing a heavy oxygen isotope. Where does the isotope show up first?", "a", [
        ["In the gas the leaf releases", "Right. Water is split in the light reactions and its oxygen leaves as $O_2$, which is what this classic experiment showed."],
        ["In the glucose produced", "This assumes water's oxygen ends up in sugar, but the sugar's oxygen comes from carbon dioxide."],
        ["In the carbon dioxide absorbed", "CO2 is an input from outside the plant, so water's oxygen does not travel back into it here."],
        ["In the chlorophyll molecules", "Chlorophyll passes energy along in the reaction and is not where the oxygen ends up."],
      ]),
      q("photo-3", PHOTO, 3, "predict", "Light is switched off in a working leaf. What happens to the Calvin cycle soon after?", "b", [
        ["It speeds up to use spare CO2", "CO2 supply is not what drives the cycle. Without energy carriers, more CO2 does not help."],
        ["It stalls as ATP and NADPH run out", "Right. The cycle needs no light directly, but it depends on carriers from the light reactions, and these run out fast."],
        ["It carries on for days unchanged", "This takes 'light independent' too literally. The cycle depends on the products of the light reactions."],
        ["It reverses and releases stored light", "Sugar breakdown is respiration, a separate process. The Calvin cycle does not store or release light."],
      ]),
      q("photo-4", PHOTO, 4, "predict", "At high light, adding more light no longer raises a leaf's rate. Which change could raise the rate?", "d", [
        ["Adding still more light", "The rate has already levelled off, which shows that light is no longer the limit."],
        ["Adding more oxygen gas", "Oxygen is a product, and extra oxygen tends to lower carbon fixation rather than raise it."],
        ["Lowering the leaf temperature well below normal", "Cooling slows enzymes, so it would pull the rate down."],
        ["A higher carbon dioxide level", "Right. Once light is plentiful, the Calvin cycle's supply of CO2 usually becomes the limiting factor."],
      ]),
      q("photo-5", PHOTO, 5, "diagnose", "A student says plants only photosynthesise and skip respiration. Which evidence best shows the error?", "c", [
        ["Plants release oxygen during daylight", "This is what photosynthesis does. It is consistent with the student's claim and refutes nothing."],
        ["Green leaves absorb red and blue light", "This describes pigments and says nothing about respiration."],
        ["Plants kept in darkness give off CO2", "Right. In the dark there is no photosynthesis to hide it, so the CO2 released reveals respiration, which runs all the time."],
        ["Plants need soil minerals for growth", "True, but minerals support growth and do not show how a plant releases energy from sugar."],
      ]),
    ],
  },
  {
    id: "market",
    title: MARKET,
    concept: MARKET,
    match: /supply|demand|equilibrium|market price|shortage|surplus|economics/i,
    intro:
      "A market price settles where the quantity people want to buy equals the quantity sellers want to sell. **A change in price moves you along a curve. A change in anything else shifts the whole curve.** Most mistakes in economics come from mixing those two up.",
    blocks: [
      {
        type: "plot",
        title: "Shift A Market",
        variable: "Q",
        domain: [0, 100],
        range: [0, 100],
        xLabel: "Quantity",
        yLabel: "Price",
        curves: [
          { label: "Demand", expr: "d - m*Q" },
          { label: "Supply", expr: "s + 0.6*Q" },
        ],
        sliders: [
          { name: "d", label: "Demand level", min: 40, max: 100, step: 1, value: 80 },
          { name: "m", label: "Demand steepness", min: 0.3, max: 1.5, step: 0.1, value: 0.8 },
          { name: "s", label: "Supply cost level", min: 0, max: 40, step: 1, value: 10 },
        ],
        hint: "Raise the supply cost and follow the crossing point: price rises, quantity falls.",
      },
      {
        type: "diagram",
        title: "Shift Or Movement",
        nodes: [
          { id: "c", label: "Something changes" },
          { id: "p", label: "Its own price", detail: "Only the good's own price moves you along a curve." },
          { id: "o", label: "Anything else", detail: "Income, tastes, input costs, the price of related goods, expectations." },
          { id: "m", label: "Move along the curve" },
          { id: "s", label: "Whole curve shifts" },
          { id: "e", label: "New equilibrium" },
        ],
        edges: [
          { from: "c", to: "p" },
          { from: "c", to: "o" },
          { from: "p", to: "m" },
          { from: "o", to: "s" },
          { from: "s", to: "e" },
        ],
      },
      {
        type: "steps",
        title: "Worked Solution",
        problem: "Demand is $P = 80 - Q$ and supply is $P = 20 + Q$. Find the equilibrium.",
        steps: [
          { ask: "Set the two prices equal. What is $Q$?", work: "$80 - Q = 20 + Q$, so $60 = 2Q$ and $Q = 30$", why: "At equilibrium buyers and sellers agree on one price, so the two equations share a value of $P$.", check: "30" },
          { ask: "Put that $Q$ into either equation. What is $P$?", work: "$P = 80 - 30 = 50$", why: "Using the other equation gives the same result, $20 + 30 = 50$, which is a useful check.", check: "50" },
        ],
        answer: "Equilibrium is $Q = 30$ at $P = 50$.",
      },
      { type: "quiz_request", topic: MARKET, concept: MARKET, count: 3 },
    ],
    cards: [
      { front: "A good's price rises. Does its demand curve shift?", back: "No. Quantity demanded falls along the same curve." },
      { front: "What does a price ceiling below equilibrium cause?", back: "A shortage: buyers want more than sellers will offer at that price." },
      { front: "Name two things that shift supply.", back: "Input costs and technology. Also taxes, subsidies and the number of sellers." },
    ],
    questions: [
      q("mkt-1", MARKET, 1, "apply", "The price of coffee beans rises sharply. What happens in the market for cups of coffee?", "a", [
        ["Supply falls, so price rises", "Right. Beans are an input, so costs rise, supply shifts left and the equilibrium price climbs."],
        ["Demand falls, so price falls", "Beans are a cost to sellers. The drinkers' wishes have not changed at any given price."],
        ["Supply rises, so price falls", "Higher input costs make selling less attractive, which moves supply the other way."],
        ["Nothing changes, so price holds", "A big jump in an input cost changes what sellers will offer at each price."],
      ]),
      q("mkt-2", MARKET, 2, "explain", "When a concert's ticket price rises, fewer people buy. How does an economist describe this?", "b", [
        ["Demand shifted to the left", "This is the classic mix-up. A shift means fewer buyers at every price, not only at the new one."],
        ["Quantity demanded fell along the curve", "Right. The ticket's own price changed, so buyers move along the same demand curve."],
        ["Supply shifted to the right", "Nothing has changed for sellers' costs, and the event is what reacted to price."],
        ["Equilibrium quantity stayed constant", "If fewer tickets sell, the quantity has changed. A constant quantity contradicts the scenario."],
      ]),
      q("mkt-3", MARKET, 3, "predict", "Rent is capped well below the market rate. What do you expect to see over time?", "c", [
        ["More rentals at lower prices for everyone", "This looks only at renters who already have a flat. Lower pay to landlords cuts the number offered."],
        ["A surplus of empty flats", "A surplus comes from a price held above equilibrium. This cap sits below it."],
        ["A shortage of available flats", "Right. At the capped price more people want flats than owners will offer, so quantity demanded exceeds quantity supplied."],
        ["No change, since the market will adjust", "A binding cap is exactly what stops price from adjusting."],
      ]),
      q("mkt-4", MARKET, 4, "predict", "A new technology cuts production costs just as the good falls out of fashion. What can you say for certain?", "d", [
        ["Price rises and quantity falls", "Both shifts push price down, so a rise is not possible here."],
        ["Price and quantity both rise", "Falling demand pulls price down too, and supply rising alone cannot lift it."],
        ["Quantity must fall by a fixed amount", "The direction of quantity depends on which shift is bigger, and nothing here fixes its size."],
        ["Price falls and quantity is unclear", "Right. Supply right and demand left both lower price, but they pull quantity in opposite directions."],
      ]),
      q("mkt-5", MARKET, 5, "diagnose", "A writer says: demand rose, which raised price, and the higher price then reduced demand, so the effect cancels. What is wrong?", "b", [
        ["Higher prices actually raise demand", "For ordinary goods a higher price lowers quantity demanded. That part of the reasoning is not the flaw."],
        ["It treats a shift and a movement as one", "Right. Demand shifted right, then quantity demanded moved along the new curve. Both end higher, nothing cancels."],
        ["Prices cannot rise when demand rises", "Rising demand does raise price, as the writer says at the start."],
        ["Supply must fall for prices to rise", "A demand shift alone is enough to raise the equilibrium price."],
      ]),
    ],
  },
];
