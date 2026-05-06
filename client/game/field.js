class Field {
    display(bgColor) {
        if (bgColor) background(bgColor);

        // Habbo Grass Colors
        const color1 = color('#4ca64c');
        const color2 = color('#429b42');

        // Draw Grass Stripes
        noStroke();
        for (let i = 0; i < C.Width; i += 40) {
            fill((i / 40) % 2 === 0 ? color1 : color2);
            rect(i, 0, 40, C.Height);
        }

        // Draw Field Lines
        strokeWeight(4);
        stroke(255, 255, 255, 220);
        noFill();

        // Center line
        line(C.Width / 2, C.ygap, C.Width / 2, C.Height - C.ygap);

        // Center circle
        circle(C.Width / 2, C.Height / 2, 140);

        // Center dot
        fill(255);
        noStroke();
        circle(C.Width / 2, C.Height / 2, 8);
        noFill();
        stroke(255);

        // Boundary lines
        line(C.xgap, C.ygap, C.Width - C.xgap, C.ygap);
        line(C.xgap, C.Height - C.ygap, C.Width - C.xgap, C.Height - C.ygap);
        line(C.Width - C.xgap, C.ygap, C.Width - C.xgap, C.Height - C.ygap);
        line(C.xgap, C.ygap, C.xgap, C.Height - C.ygap);

        // Penalty Area (Bigger rects)
        rect(C.xgap, C.Height / 4, 6 * C.xGoalGap, C.Height / 2);
        rect(C.Width - C.xgap - 6 * C.xGoalGap, C.Height / 4, 6 * C.xGoalGap, C.Height / 2);

        // Goal Box (The actual net area)
        strokeWeight(2);
        stroke(255);
        fill(255, 255, 255, 40); // Net transparent fill
        rect(C.xGoalGap, C.Height / 2 - C.goalH / 2, C.goalW, C.goalH);
        rect(C.Width - C.xgap, C.Height / 2 - C.goalH / 2, C.goalW, C.goalH);

        // Draw net pattern over the goals
        push();
        stroke(255, 255, 255, 80);
        strokeWeight(1);
        for(let i=0; i<C.goalH; i+=8) {
            line(C.xGoalGap, C.Height/2 - C.goalH/2 + i, C.xGoalGap+C.goalW, C.Height/2 - C.goalH/2 + i);
            line(C.Width - C.xgap, C.Height/2 - C.goalH/2 + i, C.Width - C.xgap + C.goalW, C.Height/2 - C.goalH/2 + i);
        }
        for(let i=0; i<C.goalW; i+=8) {
            line(C.xGoalGap+i, C.Height/2 - C.goalH/2, C.xGoalGap+i, C.Height/2 + C.goalH/2);
            line(C.Width - C.xgap+i, C.Height/2 - C.goalH/2, C.Width - C.xgap+i, C.Height/2 + C.goalH/2);
        }
        pop();

        // Goal Poles (Red)
        push();
        fill('#cc1b1b');
        stroke(0);
        strokeWeight(2);
        ellipse(C.xGoalGap+C.goalW, C.Height / 2 - C.goalH / 2, C.goalPoleRad*2.5);
        ellipse(C.xGoalGap+C.goalW, C.Height / 2 + C.goalH / 2, C.goalPoleRad*2.5);
        ellipse(C.Width - C.xgap, C.Height / 2 - C.goalH / 2, C.goalPoleRad*2.5);
        ellipse(C.Width - C.xgap, C.Height / 2 + C.goalH / 2, C.goalPoleRad*2.5);
        pop();

        // Corner arcs
        push();
        stroke(255);
        strokeWeight(4);
        noFill();
        arc(C.xgap, C.ygap, 30, 30, 0, PI/2);
        arc(C.Width - C.xgap, C.ygap, 30, 30, PI/2, PI);
        arc(C.Width - C.xgap, C.Height - C.ygap, 30, 30, PI, PI + PI/2);
        arc(C.xgap, C.Height - C.ygap, 30, 30, PI + PI/2, TWO_PI);
        pop();
    }
}
